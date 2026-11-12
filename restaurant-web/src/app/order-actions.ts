'use server';

import { PICKUP_LIFECYCLE_ACTIONS, type PickupLifecycleAction, type PickupLifecycleRequest, type AcceptOrderRequest, type OrderResponse, type MenuSelection, type RejectOrderRequest, type RestaurantOrdersResponse } from '@babmatj/contracts';

type Receipt = { action: 'accept'; body: AcceptOrderRequest } | { action: 'reject'; body: RejectOrderRequest }
 | { action: 'eta'; body: PickupLifecycleRequest & {eta: NonNullable<OrderResponse['eta']>} }
 | { action: PickupLifecycleAction; body: PickupLifecycleRequest };
type Result<T> = { data: T } | { error: string; retryable: boolean };

async function request<T>(path: string, token: string, body?: Receipt["body"] | {imageData:string|null}): Promise<Result<T>> {
 if (!/^[a-f0-9]{64}$/.test(token)) return { error: '식당 개발 토큰을 확인해주세요.', retryable: false };
 try {
  const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
  const response = await fetch(new URL(path, base), {
   method: body ? 'POST' : 'GET',
   headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
   body: body ? JSON.stringify(body) : undefined,
   cache: 'no-store',
   redirect: 'error',
   signal: AbortSignal.timeout(5000),
  });
  if (response.ok) return { data: await response.json() as T };
  if (response.status < 500) {
   const body = await response.json();
   return {
    error: typeof body.message === 'string' ? body.message : '주문 요청을 확인해주세요.',
    retryable: false,
   };
  }
 } catch {
  // A timeout can happen after commit. The caller retains the original request.
 }
 return { error: '서버에 연결할 수 없습니다. 같은 요청으로 다시 시도해주세요.', retryable: true };
}

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export async function loadOrders(restaurantId: string, token: string): Promise<Result<RestaurantOrdersResponse>> {
 if (!uuid.test(restaurantId)) return { error: '식당 ID를 확인해주세요.', retryable: false };
 return request(`/api/restaurants/${restaurantId}/orders`, token);
}

export async function submitReceipt(orderId: string, token: string, receipt: Receipt): Promise<Result<OrderResponse>> {
 if (!uuid.test(orderId) || !['accept', 'reject', 'eta', ...PICKUP_LIFECYCLE_ACTIONS].includes(receipt?.action)) {
  return { error: '주문 요청을 확인해주세요.', retryable: false };
 }
 return request(`/api/orders/${orderId}/${receipt.action}`, token, receipt.body);
}

export async function loadMenus(restaurantId: string, token: string): Promise<Result<MenuSelection[]>> {
 if (!uuid.test(restaurantId)) return {error: '식당 ID를 확인해주세요.', retryable: false};
 return request(`/api/restaurants/${restaurantId}/menus`, token);
}

export async function saveMenuImage(restaurantId: string, menuId: string, token: string, imageData: string | null) {
 if (!uuid.test(restaurantId) || !uuid.test(menuId)) return {error: '메뉴를 확인해주세요.', retryable: false};
 return request<{id:string; imageData:string|null}>(`/api/restaurants/${restaurantId}/menus/${menuId}/image`, token, {imageData});
}
