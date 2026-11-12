import assert from 'node:assert/strict';
import {test} from 'node:test';
import {waypointRoute} from '../dist/pickup/waypoint-routing.js';

test('Kakao driving summary sends a single pickup waypoint and requests shortest distance and reads meters and seconds', async t=>{
 const request=t.mock.method(globalThis,'fetch',async()=>Response.json({
  routes:[{result_code:0,summary:{duration:415,distance:2300}}],
 }));
 const result=await waypointRoute({latitude:37.5,longitude:127},
  {latitude:37.6,longitude:127.2},{latitude:37.55,longitude:127.1},'test-key');
 assert.deepEqual(result,{distanceMeters:2300,durationSeconds:415});
 const [url,options]=request.mock.calls[0].arguments;
 assert.equal(url.searchParams.get('waypoints'),'127.1,37.55');
 assert.equal(url.searchParams.get('priority'),'DISTANCE');
 assert.equal(options.headers.Authorization,'KakaoAK test-key');
 request.mock.mockImplementation(async()=>new Response(null,{status:429}));
 assert.equal(await waypointRoute({latitude:37.5,longitude:127},
  {latitude:37.6,longitude:127.2},{latitude:37.55,longitude:127.1},'test-key'),null);
});
