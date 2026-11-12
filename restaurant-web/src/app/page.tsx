import { ConnectionStatus } from '../components/connection-status';
import { RestaurantOrders } from '../components/restaurant-orders';

export default function Page() {
 return <div className="shell">
  <aside className="sidebar">
   <a className="brand" href="/" aria-label="밥맞J 식당 관리 홈">밥맞<span>J</span><small>식당 관리</small></a>
   <nav aria-label="주 메뉴"><a href="/" aria-current="page"><span aria-hidden="true">◫</span> 시작하기</a></nav>
   <p className="sidebar-note">도착 시간에 맞춘 한 끼,<br/>픽업까지 매끄럽게.</p>
  </aside>
  <main>
   <header><span>밥맞J 파트너</span><span className="badge">시작 준비</span></header>
   <div className="content">
    <p className="eyebrow">RESTAURANT WORKSPACE</p>
    <h1>픽업 준비를 시작해볼까요?</h1>
    <p className="intro">식당과 차량을 연결해, 도착에 맞춰 따뜻한 음식을 준비하세요.</p>
    <ConnectionStatus />
    <RestaurantOrders />
    <section className="setup" aria-labelledby="setup-title">
     <div className="section-heading"><h2 id="setup-title">주문을 받기 전 준비할 것</h2><span>연동 준비 중</span></div>
     <ol>
      <li><span className="step">01</span><div><h3>식당 정보와 픽업 위치</h3><p>매장 정보와 차량이 음식을 받을 장소를 등록합니다.</p></div><span className="pending">준비 예정</span></li>
      <li><span className="step">02</span><div><h3>메뉴와 조리 수용량</h3><p>메뉴를 준비하고 동시에 조리할 수 있는 주문 수를 정합니다.</p></div><span className="pending">준비 예정</span></li>
      <li><span className="step">03</span><div><h3>주문 접수와 조리 예약</h3><p>주문 수락 시 조리시간을 입력하고 도착에 맞춰 준비합니다.</p></div><span className="pending">준비 예정</span></li>
     </ol>
    </section>
   </div>
  </main>
 </div>;
}
