'use client';

import { useEffect, useState } from 'react';
import type { MenuSelection, OrderResponse, PickupLifecycleAction } from '@babmatj/contracts';
import { loadMenus, loadOrders, saveMenuImage, submitReceipt } from '../app/order-actions';

type PendingReceipt = {
 id: string;
 request: Parameters<typeof submitReceipt>[2];
};

const seoulTime = new Intl.DateTimeFormat('ko-KR', {
 dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Seoul',
});
const displayTime = (iso: string) => `${seoulTime.format(new Date(iso))} KST`;

export function RestaurantOrders() {
 const [restaurantId, setRestaurantId] = useState('');
 const [token, setToken] = useState('');
 const [orders, setOrders] = useState<OrderResponse[]>([]);
 const [menus, setMenus] = useState<MenuSelection[]>([]);
 const [total, setTotal] = useState<number | null>(null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 const [pending, setPending] = useState<PendingReceipt | null>(null);

 useEffect(() => {
  if (total === null || busy || pending) return;
  let active = true;
  let timer: ReturnType<typeof setTimeout>;
  async function poll() {
   const result = await loadOrders(restaurantId.trim(), token.trim());
   if (!active) return;
   if ('data' in result) {
    setOrders(result.data.items);
    setTotal(result.data.total);
   }
   timer = setTimeout(poll, 5000);
  }
  timer = setTimeout(poll, 5000);
  return () => { active = false; clearTimeout(timer); };
 }, [restaurantId, token, total, busy, pending]);

 async function refresh() {
  const result = await loadOrders(restaurantId.trim(), token.trim());
  if ('error' in result) return result.error;
  setOrders(result.data.items);
  setTotal(result.data.total);
  return '';
 }

 async function run(work: () => Promise<void>) {
  setBusy(true);
  setError('');
  try { await work(); }
  catch { setError('서버에 연결할 수 없습니다. 같은 요청으로 다시 시도해주세요.'); }
  finally { setBusy(false); }
 }

 async function receipt(attempt: PendingReceipt) {
  setPending(attempt);
  const result = await submitReceipt(attempt.id, token.trim(), attempt.request);
  if ('error' in result && result.retryable) {
   setError(result.error);
   return;
  }
  setPending(null);
  if ('data' in result) {
   setOrders(current => current.map(order => order.id === result.data.id ? result.data : order));
  }
  const listError = await refresh();
  setError('error' in result ? [result.error, listError].filter(Boolean).join(' ') : listError);
 }

 async function changeMenuImage(menuId: string, file?: File) {
  let imageData: string | null = null;
  if (file) {
   if (file.size > 10_000_000) { setError('10MB 이하의 사진을 선택해주세요.'); return; }
   let bitmap: ImageBitmap;
   try { bitmap = await createImageBitmap(file); }
   catch { setError('읽을 수 있는 이미지 파일을 선택해주세요.'); return; }
   const canvas = document.createElement('canvas');
   const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
   canvas.width = Math.max(1, Math.round(bitmap.width * scale));
   canvas.height = Math.max(1, Math.round(bitmap.height * scale));
   const context = canvas.getContext('2d');
   context?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
   bitmap.close();
   imageData = canvas.toDataURL('image/jpeg', 0.72);
   if (!context || imageData.length > 60_000) { setError('사진을 압축할 수 없습니다.'); return; }
  }
  const result = await saveMenuImage(restaurantId.trim(), menuId, token.trim(), imageData);
  if ('error' in result) { setError(result.error); return; }
  setMenus(current => current.map(menu => menu.id === menuId ? {...menu, imageData} : menu));
 }

 function manualAction(order: OrderResponse, action: PickupLifecycleAction, label: string) {
  return <button type="button" disabled={busy || !!pending} onClick={() => void run(() => receipt({
   id: order.id, request: { action, body: { expectedVersion: order.version, requestKey: crypto.randomUUID() } },
  }))}>{label}</button>;
 }

 return <section className="setup order-panel" aria-labelledby="orders-title">
  <h2 id="orders-title">차량 주문</h2>
  <form onSubmit={event => {
   event.preventDefault();
   void run(async () => { setOrders([]); setTotal(null); setError(await refresh()); });
  }}>
   <label>식당 ID <input required value={restaurantId} disabled={busy || !!pending} onChange={event => { setRestaurantId(event.target.value); setOrders([]); setMenus([]); setTotal(null); }} /></label>
   <label>개발 토큰 <input required type="password" autoComplete="off" value={token} disabled={busy || !!pending} onChange={event => { setToken(event.target.value); setOrders([]); setMenus([]); setTotal(null); }} /></label>
   <button disabled={busy || !!pending}>주문 목록 새로고침</button>
  </form>
  {error && <p role="alert">{error}</p>}
  {pending && <button disabled={busy} onClick={() => void run(() => receipt(pending))}>같은 주문 작업 재시도</button>}
  {total !== null && <p className="muted">최근 {orders.length}건 / 전체 {total}건</p>}
  <h3>메뉴 사진</h3>
  <button type="button" disabled={busy || !!pending} onClick={() => void run(async () => {
   const result = await loadMenus(restaurantId.trim(), token.trim());
   if ('error' in result) setError(result.error);
   else setMenus(result.data);
  })}>메뉴 불러오기</button>
  {menus.map(menu => <div key={menu.id} className="order-card">
   <strong>{menu.name}</strong>
   {menu.imageData && <img src={menu.imageData} alt={menu.name} width={96} height={96} style={{objectFit:'cover'}} />}
   <label>사진 추가·교체 <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !!pending} onChange={event => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void run(() => changeMenuImage(menu.id, file));
   }} /></label>
   {menu.imageData && <button type="button" disabled={busy || !!pending} onClick={() => void run(() => changeMenuImage(menu.id))}>사진 삭제</button>}
  </div>)}
  {orders.map(order => <article key={order.id} className="order-card">
   <h3>주문 <code>{order.id}</code></h3>
   <p>상태 <strong>{order.orderStatus === 'CANCELLED' ? 'CANCELLED · 주문 취소됨' : order.orderStatus}</strong></p>
   <p>{order.items.map(item => `${item.menuName} × ${item.quantity}`).join(', ')} · {order.pickupLocation.name}</p>
   <p>조리 상태 {order.cookingStatus} · 픽업 공간 {order.pickupSpaceReservationStatus}</p>
   {order.pickupSpaceReservation && <p>예약 구간 {displayTime(order.pickupSpaceReservation.startAt)} ~ {displayTime(order.pickupSpaceReservation.endAt)}</p>}
   {order.orderStatus === 'COMPLETED' && <p>인도 완료 · 식당 수동 확인</p>}
   <p>조리 시작 예정 {order.cookingReservation ? displayTime(order.cookingReservation.plannedStartAt) : '미정'}</p>
   {order.eta && <p>MOCK 차량 ETA {displayTime(order.eta.arrivalAt)}</p>}
   {order.pickupExpired && <p>기존 예약 만료 · 입장 불가</p>}
   {order.etaProposal ? <p>운전자 확인 대기 · 제안 픽업 {displayTime(order.etaProposal.pickupAt)} · 제안 조리 시작 {displayTime(order.etaProposal.cookingStartAt)}</p>
    : order.etaNeedsReview && <p>픽업 시간 확인 필요</p>}
   {order.orderStatus === 'ACCEPTED' && <form onSubmit={event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const now = Date.now();
    void run(() => receipt({ id: order.id, request: { action: 'eta', body: {
     expectedVersion: order.version, requestKey: crypto.randomUUID(),
     eta: { source: 'MOCK', observedAt: new Date(now).toISOString(),
      arrivalAt: new Date(now + Number(form.get('arrivalMinutes')) * 60_000).toISOString() },
    } } }));
   }}>
    <label>새 MOCK 도착까지 (분) <input name="arrivalMinutes" type="number" required min={1} max={1440} defaultValue={30} /></label>
    <button disabled={busy || !!pending}>ETA 갱신</button>
   </form>}
   {order.rejectionReason && <p>거절 사유 {order.rejectionReason}</p>}
   {order.orderStatus === 'PENDING' && <>
    <form onSubmit={event => {
     event.preventDefault();
     const form = new FormData(event.currentTarget);
     const now = Date.now();
     void run(() => receipt({ id: order.id, request: { action: 'accept', body: {
      expectedVersion: order.version, requestKey: crypto.randomUUID(),
      acceptedCookDurationMinutes: Number(form.get('duration')),
      eta: { source: 'MOCK', observedAt: new Date(now).toISOString(),
       arrivalAt: new Date(now + Number(form.get('eta')) * 60_000).toISOString() },
     } } }));
    }}>
     <label>조리시간 (분) <input name="duration" type="number" required min={1} max={240} defaultValue={20} /></label>
     <label>MOCK 도착까지 (분) <input name="eta" type="number" required min={1} max={1440} defaultValue={30} /></label>
     <button disabled={busy || !!pending}>수락</button>
    </form>
    <form onSubmit={event => {
     event.preventDefault();
     const reason = String(new FormData(event.currentTarget).get('reason')).trim();
     if (!reason) { setError('거절 사유를 입력해주세요.'); return; }
     void run(() => receipt({ id: order.id, request: { action: 'reject', body: {
      reason, expectedVersion: order.version, requestKey: crypto.randomUUID(),
     } } }));
    }}>
     <label>거절 사유 <input name="reason" required maxLength={500} /></label>
     <button disabled={busy || !!pending}>거절</button>
    </form>
   </>}
   {(order.orderStatus === 'PENDING' || order.orderStatus === 'ACCEPTED') && <div className="order-operations">
    {(order.orderStatus === 'PENDING' || (order.cookingStatus === 'SCHEDULED' &&
     order.pickupSpaceReservationStatus !== 'OCCUPIED')) && manualAction(order, 'cancel', '주문 취소')}
    {order.orderStatus === 'ACCEPTED' && <>
     {order.cookingStatus === 'SCHEDULED' && manualAction(order, 'start', '수동 조리 시작')}
     {order.cookingStatus === 'COOKING' && manualAction(order, 'ready', '수동 준비 완료')}
     {order.pickupSpaceReservationStatus === 'RESERVED' && !order.pickupExpired && manualAction(order, 'arrive', '수동 입장 확인')}
     {order.cookingStatus === 'READY' && order.pickupSpaceReservationStatus === 'OCCUPIED' &&
      manualAction(order, 'complete', '수동 인도 완료')}
    </>}
   </div>}
  </article>)}
 </section>;
}
