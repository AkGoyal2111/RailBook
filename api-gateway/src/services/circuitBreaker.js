const { ServiceUnavailableError } = require('../utils/error');

const DEFAULT_THRESHOLD = 5;
const DEFAULT_TIMEOUT = 60000;

/**
 * Circuit Breaker — prevents cascading failures when a downstream service is down.
 * States: CLOSED (normal) → OPEN (failing, reject fast) → HALF_OPEN (probe) → CLOSED.
 * The logger is injected (defaults to console) so this stays dependency-free and
 * unit-testable in isolation — no config, winston, or axios in its require chain.
 */
class CircuitBreaker {
     constructor(serviceName, threshold = DEFAULT_THRESHOLD, timeout = DEFAULT_TIMEOUT, logger = console) {
          this.serviceName = serviceName;
          this.failureCount = 0;
          this.threshold = threshold;
          this.timeout = timeout;
          this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
          this.nextAttempt = Date.now();
          this.logger = logger;
     }

     async execute(request) {
          if (this.state === 'OPEN') {
               if (Date.now() < this.nextAttempt) {
                    throw new ServiceUnavailableError(
                         `Service ${this.serviceName} is temporarily unavailable. Circuit breaker is OPEN.`
                    );
               }
               // Timeout elapsed — allow a single probe request.
               this.state = 'HALF_OPEN';
               this.logger.info(`Circuit breaker HALF_OPEN for ${this.serviceName}`);
          }

          try {
               const response = await request();
               this.onSuccess();
               return response;
          } catch (err) {
               this.onFailure();
               throw err;
          }
     }

     onSuccess() {
          this.failureCount = 0;
          if (this.state === 'HALF_OPEN') {
               this.state = 'CLOSED';
               this.logger.info(`Circuit breaker CLOSED for ${this.serviceName}`);
          }
     }

     onFailure() {
          this.failureCount++;
          if (this.failureCount >= this.threshold) {
               this.state = 'OPEN';
               this.nextAttempt = Date.now() + this.timeout;
               this.logger.error(
                    `Circuit breaker OPEN for ${this.serviceName}. Next attempt at ${new Date(this.nextAttempt).toISOString()}`
               );
          }
     }

     getState() {
          return {
               service: this.serviceName,
               state: this.state,
               failureCount: this.failureCount,
               nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null,
          };
     }
}

module.exports = CircuitBreaker;
