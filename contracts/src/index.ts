export const ORDER_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED'] as const;
export const COOKING_STATUSES = ['UNSCHEDULED', 'SCHEDULED', 'COOKING', 'READY'] as const;
export const VEHICLE_STATUSES = ['UNKNOWN', 'EN_ROUTE', 'NEARBY', 'ARRIVED'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
export type CookingStatus = typeof COOKING_STATUSES[number];
export type VehicleStatus = typeof VEHICLE_STATUSES[number];

export interface HealthResponse {
 status: 'ok';
 service: 'babmatj-server';
 database: 'not_configured' | 'not_verified' | 'local_ready';
}
export function isHealthResponse(value: unknown): value is HealthResponse {
 if (typeof value !== 'object' || value === null) return false;
 const item = value as Record<string, unknown>;
 return item.status === 'ok' && item.service === 'babmatj-server' &&
  (item.database === 'not_configured' || item.database === 'not_verified' || item.database === 'local_ready');
}

export interface PickupLocation {
 id: string; name: string; address: string; latitude: number; longitude: number; instructions: string | null;
}
export interface MenuSelection { id: string; name: string; priceKrw: number; }
export interface CreateOrderRequest {
 restaurantId: string; pickupLocationId: string; vehiclePlate: string; contactPhone: string; requestKey: string;
 items: Array<{menuId: string; quantity: number}>;
}
export interface OrderResponse {
 id: string; userId: string; restaurantId: string; orderStatus: OrderStatus;
 cookingStatus: CookingStatus; vehicleStatus: VehicleStatus; vehiclePlate: string; contactPhone: string;
 pickupLocation: PickupLocation;
 items: Array<{id: string; menuName: string; quantity: number; unitPriceKrw: number}>;
 totalPriceKrw: number; createdAt: string;
 version: number;
 rejectionReason: string | null;
 acceptedCookDurationMinutes: number | null;
 eta: {source: 'MOCK'; arrivalAt: string; observedAt: string} | null;
 cookingReservation: {id: string; plannedStartAt: string; plannedEndAt: string} | null;
 pickupSpaceReservationStatus: 'NOT_IMPLEMENTED';
}

export interface AcceptOrderRequest {
 acceptedCookDurationMinutes: number;
 preparationBufferMinutes?: number;
 expectedVersion: number;
 requestKey: string;
 eta?: {source: 'MOCK'; arrivalAt: string; observedAt: string};
}
export interface RejectOrderRequest {expectedVersion: number; requestKey: string; reason: string;}
export interface RestaurantOrdersResponse {items: OrderResponse[]; total: number; limit: number; offset: number;}
