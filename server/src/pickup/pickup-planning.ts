import type { CookingStatus } from '@babmatj/contracts';

const minuteMs = 60_000;


interface Reservation {
  id: string;
  startAt: number;
  endAt: number;
  status: 'RESERVED' | 'IN_USE' | 'RELEASED' | 'CANCELLED';
}

interface PlanningInput {
  now: number;
  eta: number;
  cookMinutes: number;
  handoffMinutes?: number;
  cookingStatus: CookingStatus | 'LOCKED';
  existingCookingStartAt?: number;
  current?: Reservation;
  reservations: readonly Reservation[];
}

type Reason =
  | 'PICKUP_CONFLICT'
  | 'ETA_DELAYED'
  | 'COOKING_LOCKED'
  | 'RESERVATION_CANCELLED'
  | 'SPACE_IN_USE'
  | 'INSUFFICIENT_COOKING_TIME';

interface PickupPlan {
  availableAtEta: boolean;
  confirmedPickupAt: number | null;
  proposedPickupAt: number | null;
  // A proposed start when there is a proposed slot, or the persisted start under LOCK.
  cookingStartAt: number | null;
  reasons: Reason[];
}

// Times are epoch milliseconds. The snapshot covers one pickup space.
// Availability is advisory. Committing a reservation requires an atomic DB check.
export function planPickup(input: PlanningInput): PickupPlan {
  const { now, eta, cookMinutes, current, reservations, cookingStatus, existingCookingStartAt } = input;
  const handoffMinutes = input.handoffMinutes ?? 3;
  if (!Number.isSafeInteger(handoffMinutes) || handoffMinutes < 1 || handoffMinutes > 60) {
    throw new RangeError("Invalid pickup occupancy duration.");
  }
  const occupancyMs = handoffMinutes * minuteMs;
  const locked = cookingStatus === 'LOCKED' || cookingStatus === 'COOKING' || cookingStatus === 'READY';
  if (![now, eta].every(Number.isSafeInteger) || !Number.isSafeInteger(cookMinutes) || cookMinutes <= 0) {
    throw new RangeError('A valid ETA, clock and positive cooking duration are required.');
  }
  const durationMs = cookMinutes * minuteMs;
  if (!Number.isSafeInteger(now + durationMs) || (locked && !Number.isSafeInteger(existingCookingStartAt))) {
    throw new RangeError('A valid cooking schedule is required.');
  }
  for (const slot of current ? [...reservations, current] : reservations) {
    if (![slot.startAt, slot.endAt].every(Number.isSafeInteger) || slot.endAt <= slot.startAt) {
      throw new RangeError('A reservation must have a valid start and end.');
    }
  }

  const reasons: Reason[] = [];
  const plan: PickupPlan = {
    availableAtEta: false,
    confirmedPickupAt: null,
    proposedPickupAt: null,
    cookingStartAt: locked ? existingCookingStartAt! : null,
    reasons,
  };
  if (current?.status === 'CANCELLED' || current?.status === 'RELEASED') {
    reasons.push('RESERVATION_CANCELLED');
    return plan;
  }
  plan.confirmedPickupAt = current?.startAt ?? null;
  if (current && eta > current.startAt) reasons.push('ETA_DELAYED');
  if (locked) reasons.push('COOKING_LOCKED');
  if (current?.status === 'IN_USE') {
    reasons.push('SPACE_IN_USE');
    return plan;
  }

  const earliestPickup = locked ? Math.max(now, existingCookingStartAt! + durationMs) : now + durationMs;
  const blocks = reservations
    .filter((slot) => slot.id !== current?.id && (slot.status === 'RESERVED' || slot.status === 'IN_USE'))
    .map((slot) => ({
      startAt: slot.status === 'IN_USE' ? Math.min(now, slot.startAt) : slot.startAt,
      endAt: slot.status === 'IN_USE' ? Infinity : slot.endAt,
    }))
    .sort((a, b) => a.startAt - b.startAt);
  const collides = blocks.some((slot) => eta < slot.endAt && slot.startAt < eta + occupancyMs);
  if (eta < earliestPickup) reasons.push('INSUFFICIENT_COOKING_TIME');
  if (collides && !blocks.some((slot) => slot.endAt === Infinity)) reasons.push('PICKUP_CONFLICT');
  let candidate = Math.max(eta, earliestPickup);
  for (const slot of blocks) {
    if (candidate + occupancyMs <= slot.startAt) break;
    candidate = Math.max(candidate, slot.endAt);
  }
  if (!Number.isFinite(candidate)) {
    reasons.push('SPACE_IN_USE');
    return plan;
  }

  plan.availableAtEta = candidate === eta;
  if (candidate !== plan.confirmedPickupAt) plan.proposedPickupAt = candidate;
  if (!locked) plan.cookingStartAt = candidate - durationMs;
  return plan;
}
