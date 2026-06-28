const Razorpay = require('razorpay');
const BaseGateway = require('./base.gateway');
const logger = require('../../config/logger');
const { verifyPaymentSignature, verifyWebhookSignature } = require('./signature');

class RazorpayGateway extends BaseGateway {
     constructor(keyId, keySecret, webhookSecret) {
          super('razorpay');
          this.keyId = keyId;
          this.keySecret = keySecret;
          this.webhookSecret = webhookSecret;
          this.client = new Razorpay({
               key_id: keyId,
               key_secret: keySecret,
          });
     }

     async createOrder(amount, currency, receipt, notes = {}) {
          const amountInPaise = Math.round(amount * 100);

          let order;
          try {
               order = await this.client.orders.create({
                    amount: amountInPaise,
                    currency,
                    receipt,
                    notes,
               });
          } catch (err) {
               // Razorpay SDK throws plain objects, not Error instances
               const description = err?.error?.description || err?.message || JSON.stringify(err);
               logger.error(`Razorpay createOrder failed: ${description}`);
               const { BadRequestError } = require('../../utils/error');
               throw new BadRequestError(`Payment gateway error: ${description}`, 'PAYMENT_GATEWAY_ERROR');
          }

          logger.info(`Razorpay order created: ${order.id}`, { receipt, amount });

          return {
               gatewayOrderId: order.id,
               amount: order.amount / 100,
               currency: order.currency,
               receipt: order.receipt,
               rawResponse: order,
          };
     }

     verifyPaymentSignature(orderId, paymentId, signature) {
          return verifyPaymentSignature(this.keySecret, orderId, paymentId, signature);
     }

     verifyWebhookSignature(rawBody, signature) {
          return verifyWebhookSignature(this.webhookSecret, rawBody, signature);
     }

     async initiateRefund(paymentId, amount, notes = {}) {
          const amountInPaise = Math.round(amount * 100);

          const refund = await this.client.payments.refund(paymentId, {
               amount: amountInPaise,
               notes,
          });

          logger.info(`Razorpay refund initiated: ${refund.id}`, { paymentId, amount });

          return {
               gatewayRefundId: refund.id,
               status: refund.status,
               amount: refund.amount / 100,
               rawResponse: refund,
          };
     }
}

module.exports = RazorpayGateway;
