'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isHealthResponse, type HealthResponse } from '@babmatj/contracts';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: HealthResponse };
export function ConnectionStatus() {
 const [state, setState] = useState<State>({ kind: 'loading' });
 const active = useRef<AbortController | null>(null);
 const check = useCallback(async () => {
  active.current?.abort();
  const controller = new AbortController();
  active.current = controller;
  setState({ kind: 'loading' });
  try {
   const response = await fetch('/api/health', {
    cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
   });
   const data: unknown = await response.json();
   if (!response.ok || !isHealthResponse(data)) throw new Error('Unavailable');
   if (!controller.signal.aborted) setState({ kind: 'ready', data });
  } catch {
   if (!controller.signal.aborted) setState({ kind: 'error' });
  }
 }, []);
 useEffect(() => { void check(); return () => active.current?.abort(); }, [check]);
 return <section className="connection" aria-label="연결 상태">
  <div>
   <span className="eyebrow">연결 상태</span>
   <p role="status" aria-live="polite" className="connection-title">
    <span aria-hidden="true" className={`dot ${state.kind}`} />
    {state.kind === 'loading' ? '연결 확인 중' : state.kind === 'ready' ? '중앙 서버 연결됨' : '중앙 서버 연결 대기'}
   </p>
   <p className="muted">{state.kind === 'ready'
    ? state.data.database === 'local_ready' ? '로컬 데이터베이스에 연결되었습니다.' : state.data.database === 'not_configured' ? '데이터베이스 연결을 준비하고 있습니다.' : '데이터베이스 연결 확인이 필요합니다.'
    : state.kind === 'error' ? '서버가 실행 중인지 확인한 뒤 다시 시도해주세요.' : '주문을 받을 준비가 되었는지 확인합니다.'}</p>
  </div>
  <button onClick={() => void check()} disabled={state.kind === 'loading'}>다시 확인 <span aria-hidden="true">↗</span></button>
 </section>;
}
