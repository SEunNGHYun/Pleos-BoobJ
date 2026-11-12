import assert from 'node:assert/strict';
import test from 'node:test';
import { planPickup } from '../dist/pickup/pickup-planning.js';

const minute = 60_000;
const now = Date.parse('2026-11-07T10:00:00Z');
const eta = now + 30 * minute;
const input = { now, eta, cookMinutes: 20, reservations: [], cookingStatus: 'SCHEDULED' };
const slot = (startAt, status = 'RESERVED') => ({ id: String(startAt), startAt, endAt: startAt + 3 * minute, status });

test('an unbooked slot is a proposal and only an existing reservation is confirmed', () => {
  assert.deepEqual(planPickup(input), {
    availableAtEta: true, confirmedPickupAt: null, proposedPickupAt: eta,
    cookingStartAt: now + 10 * minute, reasons: [],
  });
  const current = slot(eta);
  const plan = planPickup({ ...input, current, reservations: [{ ...current }] });
  assert.equal(plan.confirmedPickupAt, eta);
  assert.equal(plan.proposedPickupAt, null);
});

test('collisions across multiple slots advance to the first gap and allow adjacent boundaries', () => {
  const plan = planPickup({ ...input, reservations: [slot(eta + 3 * minute), slot(eta)] });
  assert.equal(plan.availableAtEta, false);
  assert.equal(plan.proposedPickupAt, eta + 6 * minute);
  assert.equal(plan.cookingStartAt, now + 16 * minute);
  assert.deepEqual(plan.reasons, ['PICKUP_CONFLICT']);
  for (const start of [eta - 3 * minute, eta + 3 * minute]) {
    assert.equal(planPickup({ ...input, reservations: [slot(start)] }).availableAtEta, true);
  }
});

test('late ETA retains the confirmed booking until a new proposal is approved', () => {
  const plan = planPickup({ ...input, eta: eta + minute, current: slot(eta) });
  assert.equal(plan.confirmedPickupAt, eta);
  assert.equal(plan.proposedPickupAt, eta + minute);
  assert.equal(plan.cookingStartAt, now + 11 * minute);
  assert.deepEqual(plan.reasons, ['ETA_DELAYED']);
});

test('LOCKED, COOKING and READY preserve the stored start across ETA changes', () => {
  for (const cookingStatus of ['LOCKED', 'COOKING', 'READY']) {
    const plan = planPickup({ ...input, eta: eta + minute, current: slot(eta),
      cookingStatus, existingCookingStartAt: now + 10 * minute });
    assert.equal(plan.cookingStartAt, now + 10 * minute);
    assert.ok(plan.reasons.includes('COOKING_LOCKED'));
  }
});

test('cancelled bookings free capacity and cancellation of the current booking stops planning', () => {
  assert.equal(planPickup({ ...input, reservations: [slot(eta, 'CANCELLED')] }).availableAtEta, true);
  const cancelled = planPickup({ ...input, current: slot(eta, 'CANCELLED') });
  assert.equal(cancelled.proposedPickupAt, null);
  assert.equal(cancelled.cookingStartAt, null);
  assert.deepEqual(cancelled.reasons, ['RESERVATION_CANCELLED']);
});

test('actual occupancy blocks proposals even beyond the planned end', () => {
  const plan = planPickup({ ...input, reservations: [slot(now, 'IN_USE')] });
  assert.equal(plan.availableAtEta, false);
  assert.equal(plan.proposedPickupAt, null);
  assert.deepEqual(plan.reasons, ['SPACE_IN_USE']);
});

test('preparation must fit from now and invalid inputs fail', () => {
  const plan = planPickup({ ...input, eta: now + 19 * minute });
  assert.equal(plan.proposedPickupAt, now + 20 * minute);
  assert.equal(plan.cookingStartAt, now);
  assert.deepEqual(plan.reasons, ['INSUFFICIENT_COOKING_TIME']);
  assert.equal(planPickup({ ...input, eta: now + 20 * minute }).availableAtEta, true);
  assert.throws(() => planPickup({ ...input, cookMinutes: 0 }), RangeError);
  assert.throws(() => planPickup({ ...input, reservations: [{ ...slot(eta), endAt: eta }] }), RangeError);
  assert.throws(() => planPickup({ ...input, cookingStatus: 'LOCKED' }), RangeError);
});

test('parallel callers get proposals only; a subsequent snapshot detects the committed slot', async () => {
  const plans = await Promise.all([input, input].map(async (snapshot) => planPickup(snapshot)));
  assert.ok(plans.every((plan) => plan.confirmedPickupAt === null && plan.proposedPickupAt === eta));
  assert.equal(planPickup({ ...input, reservations: [slot(eta)] }).proposedPickupAt, eta + 3 * minute);
});
