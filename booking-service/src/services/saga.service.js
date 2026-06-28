const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { inventoryClient } = require('./inventoryClient');
const { paymentClient } = require('./paymentClient');

/**
 * Saga orchestrator for booking lifecycle.
 * Each step is logged to SagaLog for auditability and crash recovery.
 *
 * Forward flow: HOLD_SEATS -> CREATE_PAYMENT -> CONFIRM_SEATS -> COMPLETE
 * Compensation: reverse order of completed steps
 */

// ─── Forward Steps ───────────────────────────────────────────────────────────

// --- SEGMENT BOOKING: Added fromSeq/toSeq params ---
// saga ka step 1 — inventory service ko bolo ki ye seats hold karo (lock karo)
// pehle sagaLog mein PENDING entry banao (audit trail ke liye)
// phir inventoryClient.holdSeats call karo — success pe sagaLog COMPLETED, booking SEATS_HELD
// fail pe sagaLog FAILED aur error throw karo
async function executeHoldSeats(booking, seatIds, ttlSeconds, fromSeq, toSeq) {
     const sagaLog = await prisma.sagaLog.create({
          data: {
               bookingId: booking.id,
               step: 'HOLD_SEATS',
               status: 'PENDING',
               request: { scheduleId: booking.scheduleId, seatIds, userId: booking.userId, ttlSeconds, fromSeq, toSeq }, // --- SEGMENT BOOKING
          },
     });

     try {
          const result = await inventoryClient.holdSeats(
               booking.scheduleId,
               seatIds,
               booking.userId,
               ttlSeconds,
               fromSeq,  // --- SEGMENT BOOKING
               toSeq     // --- SEGMENT BOOKING
          );

          await prisma.sagaLog.update({
               where: { id: sagaLog.id },
               data: { status: 'COMPLETED', response: result },
          });

          await prisma.booking.update({
               where: { id: booking.id },
               data: { status: 'SEATS_HELD' },
          });

          logger.info(`Saga HOLD_SEATS completed for booking ${booking.id}`);
          return result;

     } catch (error) {
          const errorMsg = error.response?.data?.message || error.message;
          await prisma.sagaLog.update({
               where: { id: sagaLog.id },
               data: { status: 'FAILED', error: errorMsg },
          });
          throw error;
     }
}

// saga ka step 2 — payment service ko bolo ki razorpay order banao
// sagaLog mein PENDING entry, phir paymentClient.createPaymentOrder call karo
// success pe sagaLog COMPLETED, booking status PAYMENT_PENDING, paymentOrderId save karo
// fail pe sagaLog FAILED aur error throw karo
async function executeCreatePayment(booking) {
     const idempotencyKey = `${booking.id}-payment`;

     const sagaLog = await prisma.sagaLog.create({
          data: {
               bookingId: booking.id,
               step: 'CREATE_PAYMENT',
               status: 'PENDING',
               request: { bookingId: booking.id, amount: booking.totalAmount, userId: booking.userId },
          },
     });

     try {
          const result = await paymentClient.createPaymentOrder(
               booking.id,
               booking.totalAmount,
               booking.userId,
               idempotencyKey
          );

          await prisma.sagaLog.update({
               where: { id: sagaLog.id },
               data: { status: 'COMPLETED', response: result },
          });

          await prisma.booking.update({
               where: { id: booking.id },
               data: {
                    status: 'PAYMENT_PENDING',
                    paymentOrderId: result.paymentOrderId,
               },
          });

          logger.info(`Saga CREATE_PAYMENT completed for booking ${booking.id}`);
          return result;

     } catch (error) {
          const errorMsg = error.response?.data?.message || error.message;
          await prisma.sagaLog.update({
               where: { id: sagaLog.id },
               data: { status: 'FAILED', error: errorMsg },
          });
          throw error;
     }
}

// --- SEGMENT BOOKING: Added fromSeq/toSeq params ---
// saga ka step 3 — payment success hone ke baad inventory ko bolo seats confirm karo
// basically seats ka status LOCKED se BOOKED karo permanently
// sagaLog PENDING → COMPLETED on success, FAILED on error
async function executeConfirmSeats(booking, seatIds, fromSeq, toSeq) {
     const sagaLog = await prisma.sagaLog.create({
          data: {
               bookingId: booking.id,
               step: 'CONFIRM_SEATS',
               status: 'PENDING',
               request: { scheduleId: booking.scheduleId, seatIds, userId: booking.userId, bookingId: booking.id, fromSeq, toSeq }, // --- SEGMENT BOOKING
          },
     });

     try {
          const result = await inventoryClient.confirmSeats(
               booking.scheduleId,
               seatIds,
               booking.userId,
               booking.id,
               fromSeq,  // --- SEGMENT BOOKING
               toSeq     // --- SEGMENT BOOKING
          );

          await prisma.sagaLog.update({
               where: { id: sagaLog.id },
               data: { status: 'COMPLETED', response: result },
          });

          logger.info(`Saga CONFIRM_SEATS completed for booking ${booking.id}`);
          return result;

     } catch (error) {
          const errorMsg = error.response?.data?.message || error.message;
          await prisma.sagaLog.update({
               where: { id: sagaLog.id },
               data: { status: 'FAILED', error: errorMsg },
          });
          throw error;
     }
}

// ─── Compensation Steps ──────────────────────────────────────────────────────

// compensation step 1 — agar booking fail ho to hold kari hui seats wapas release karo
// inventory ko bolo unlock karo, phir sagaLog mein COMPENSATED mark karo
// agar ye bhi fail ho to chinta nahi — lock expire hone pe automatically release ho jayengi
async function compensateHoldSeats(booking, seatIds) {
     logger.info(`Compensating HOLD_SEATS for booking ${booking.id}`);
     try {
          // --- SEGMENT BOOKING: Pass segment params from booking for accurate compensation ---
          await inventoryClient.releaseSeats(booking.scheduleId, seatIds, booking.userId, booking.fromSeq, booking.toSeq);

          // Mark saga step as compensated
          await prisma.sagaLog.updateMany({
               where: { bookingId: booking.id, step: 'HOLD_SEATS', status: 'COMPLETED' },
               data: { status: 'COMPENSATED' },
          });
     } catch (error) {
          logger.error(`Failed to compensate HOLD_SEATS for booking ${booking.id}`, {
               error: error.message,
          });
          // Inventory lock expiry will eventually clean this up
     }
}

// compensation step 2 — agar payment order ban gaya tha to uska refund shuru karo
// agar paymentOrderId hi nahi tha to kuch karne ki zaroorat nahi
async function compensateCreatePayment(booking) {
     if (!booking.paymentOrderId) return;

     logger.info(`Compensating CREATE_PAYMENT for booking ${booking.id}`);
     try {
          const idempotencyKey = `${booking.id}-refund-compensation`;
          await paymentClient.initiateRefund(
               booking.paymentOrderId,
               booking.totalAmount,
               'booking_compensation',
               idempotencyKey
          );

          await prisma.sagaLog.updateMany({
               where: { bookingId: booking.id, step: 'CREATE_PAYMENT', status: 'COMPLETED' },
               data: { status: 'COMPENSATED' },
          });
     } catch (error) {
          logger.error(`Failed to compensate CREATE_PAYMENT for booking ${booking.id}`, {
               error: error.message,
          });
     }
}

// compensation step 3 — agar seats confirm ho gayi thi payment ke baad, aur phir kuch fail hua
// to inventory ko bolo booking cancel karo (seats wapas available karo)
async function compensateConfirmSeats(booking) {
     logger.info(`Compensating CONFIRM_SEATS for booking ${booking.id}`);
     try {
          await inventoryClient.cancelBooking(booking.scheduleId, booking.id, booking.userId);

          await prisma.sagaLog.updateMany({
               where: { bookingId: booking.id, step: 'CONFIRM_SEATS', status: 'COMPLETED' },
               data: { status: 'COMPENSATED' },
          });
     } catch (error) {
          logger.error(`Failed to compensate CONFIRM_SEATS for booking ${booking.id}`, {
               error: error.message,
          });
     }
}

/**
 * Compensate all completed saga steps in reverse order.
 * Used when a booking needs to be rolled back (failure, timeout, cancellation).
 */
// master undo function — jo bhi saga steps complete ho chuke h unhe ulte order mein undo karo
// db se check karo kaunse steps COMPLETED the, phir unka compensation chalao
// order: pehle CONFIRM_SEATS undo, phir CREATE_PAYMENT undo, phir HOLD_SEATS undo
async function compensateAll(booking, seatIds) {
     const completedSteps = await prisma.sagaLog.findMany({
          where: { bookingId: booking.id, status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
     });

     for (const step of completedSteps) {
          switch (step.step) {
               case 'CONFIRM_SEATS':
                    await compensateConfirmSeats(booking);
                    break;
               case 'CREATE_PAYMENT':
                    await compensateCreatePayment(booking);
                    break;
               case 'HOLD_SEATS':
                    await compensateHoldSeats(booking, seatIds);
                    break;
          }
     }
}

module.exports = {
     executeHoldSeats,
     executeCreatePayment,
     executeConfirmSeats,
     compensateHoldSeats,
     compensateCreatePayment,
     compensateConfirmSeats,
     compensateAll,
};
