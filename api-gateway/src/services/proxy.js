const axios = require('axios');
const { config } = require('../config');
const { ServiceUnavailableError, GatewayTimeoutError } = require('../utils/error');
const logger = require('../config/logger');
const CircuitBreaker = require('./circuitBreaker');

// One circuit breaker per downstream service, configured from env.
const makeBreaker = (name) =>
     new CircuitBreaker(name, config.CIRCUIT_BREAKER_THRESHOLD, config.CIRCUIT_BREAKER_TIMEOUT, logger);

const circuitBreakers = {
     userService: makeBreaker('user-service'),
     searchService: makeBreaker('search-service'),
     adminService: makeBreaker('admin-service'),
     bookingService: makeBreaker('booking-service'),
     paymentService: makeBreaker('payment-service'),
     inventoryService: makeBreaker('inventory-service')
};


/**
 * Forward request to downstream service
 */
async function forwardRequest(serviceUrl, path, method, data, headers, circuitBreaker) {
     const url = `${serviceUrl}${path}`;
     logger.info(url);
     // http://localhost:4001/auth/login
     const requestConfig = {
          method,
          url,
          timeout: config.SERVICE_TIMEOUT_MS,
          headers: {
               ...headers,
               // Remove host header to avoid conflicts
               host: undefined,
               // Remove content-length to let axios recalculate
               'content-length': undefined,
          },
          // Important: Don't validate status, let service response through
          validateStatus: () => true,
          // Set max redirects
          maxRedirects: 5,
     };

     // Add data based on method
     if (method !== 'GET' && method !== 'DELETE' && data) {
          requestConfig.data = data;
     }

     // For GET and DELETE, add params if data exists
     if ((method === 'GET' || method === 'DELETE') && data) {
          requestConfig.params = data;
     }

     logger.debug(`Forwarding ${method} ${url}`, {
          headers: requestConfig.headers,
          hasData: !!data,
          timeout: config.SERVICE_TIMEOUT_MS,
     });

     try {
          const response = await circuitBreaker.execute(() => axios(requestConfig));

          logger.debug(`Response from ${url}:`, {
               status: response.status,
               statusText: response.statusText,
          });

          return {
               status: response.status,
               data: response.data,
               headers: response.headers,
          };
     } catch (err) {
          logger.error(`Error forwarding to ${serviceUrl}:`, {
               message: err.message,
               code: err.code,
               url: url,
               method: method,
               timeout: config.SERVICE_TIMEOUT_MS,
          });

          if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
               throw new GatewayTimeoutError(`Request to ${serviceUrl} timed out after ${config.SERVICE_TIMEOUT_MS}ms`);
          }

          if (err.code === 'ECONNREFUSED') {
               throw new ServiceUnavailableError(`Cannot connect to ${serviceUrl}. Service may be down.`);
          }

          if (err.response) {
               logger.error(`Service error from ${serviceUrl}:`, {
                    status: err.response.status,
                    data: err.response.data,
               });

               return {
                    status: err.response.status,
                    data: err.response.data,
                    headers: err.response.headers,
               };
          }

          // Network error or service down--You would have seen this in video
          logger.error(`Network error while calling ${serviceUrl}:`, err.message);
          throw new ServiceUnavailableError(`Service temporarily unavailable: ${err.message}`);
     }
}

/**
 * Proxy middleware factory
 *
 * @param {object} [options]
 * @param {boolean} [options.preservePath] When true, the full path is forwarded
 *   to the service instead of stripping the first segment. Used by search, which
 *   is served by admin-service under its own /search prefix.
 */
function createProxy(serviceName, serviceUrl, options = {}) {
     const { preservePath = false } = options;
     const circuitBreaker = circuitBreakers[serviceName];

     if (!circuitBreaker) {
          throw new Error(`No circuit breaker found for service: ${serviceName}`);
     }

     return async (req, res, next) => {
          try {
               // Extract path (remove /api prefix only)
               // Gateway: /api/users/auth/login -> Service: /auth/login
               // Gateway: /api/users/user/profile -> Service: /user/profile
               logger.info(req.path);
               const pathParts = req.path.split('/').filter(Boolean);
               logger.info(pathParts);
               // Default: drop the first segment (the service name).
               // ['users', 'auth', 'login'] -> ['auth', 'login'] -> '/auth/login'
               // preservePath: keep the whole path (e.g. '/search/trains').
               const servicePath = preservePath
                    ? '/' + pathParts.join('/')
                    : '/' + pathParts.slice(1).join('/');
               logger.info(servicePath);

               const result = await forwardRequest(
                    serviceUrl,
                    servicePath + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''),
                    req.method,
                    req.body,
                    req.headers,
                    circuitBreaker
               );

               // Forward response headers (except some)
               const excludeHeaders = ['connection', 'keep-alive', 'transfer-encoding', 'host'];
               Object.keys(result.headers).forEach((key) => {
                    if (!excludeHeaders.includes(key.toLowerCase())) {
                         res.setHeader(key, result.headers[key]);
                    }
               });

               // Send response
               res.status(result.status).json(result.data);
          } catch (err) {
               next(err);
          }
     };
}

/**
 * Health check endpoint for circuit breakers
 */
function getCircuitBreakerStatus() {
     return Object.values(circuitBreakers).map((cb) => cb.getState());
}

module.exports = {
     createProxy,
     CircuitBreaker,
     circuitBreakers,
     getCircuitBreakerStatus,
};