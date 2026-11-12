import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {LocalDatabase} from '../dist/database/local-database.js';
import {restaurantInput} from '../dist/pickup/input.js';
import {PickupService} from '../dist/pickup/pickup.service.js';

if (!process.env.LOCAL_DB_PATH) {
 throw new Error('먼저 npm run local:setup으로 로컬 DB를 설정해주세요.');
}

const credentialPath = process.env.LOCAL_SEED_CREDENTIALS_PATH
 ?? new URL('../../.local/credentials.json', import.meta.url);
const {owner} = JSON.parse(await readFile(credentialPath, 'utf8'));
const fixture = new URL('./fixtures/demo-restaurants.json', import.meta.url);
const restaurants = JSON.parse(await readFile(fixture, 'utf8')).map(input => restaurantInput.parse(input));
const db = await LocalDatabase.open(resolve(process.env.LOCAL_DB_PATH));

try {
 const actor = await db.authenticate(owner.token);
 if (!actor || actor !== owner.userId) {
  throw new Error('개발용 운영자 계정과 로컬 DB가 일치하지 않습니다.');
 }
 const pickup = new PickupService(db);
 for (const input of restaurants) {
  const existing = await db.withServerRole(tx => tx.query(
   `select r.id from restaurants r join restaurant_members m on m.restaurant_id=r.id
    where m.user_id=$1 and m.role='OWNER' and r.name=$2 limit 1`,
   [actor, input.name],
  ));
  const restaurant = existing.rows[0] ?? await pickup.registerRestaurant(actor, input);
  if (existing.rows.length && input.imageData) {
   await db.withServerRole(async tx => {
    const image = await tx.query(
     'insert into restaurant_images values ($1,$2) on conflict do nothing returning restaurant_id',
     [restaurant.id, input.imageData],
    );
    if (!image.rows.length) return;
    for (const menu of input.menus) {
     if (!menu.imageData) continue;
     await tx.query(
      'insert into menu_images select id,$3 from menus where restaurant_id=$1 and name=$2 on conflict do nothing',
      [restaurant.id, menu.name, menu.imageData],
     );
    }
   });
  }
  console.log(`${existing.rows.length ? '건너뜀' : '등록'} · ${input.name} · ${restaurant.id}`);
 }
} finally {
 await db.close();
}
