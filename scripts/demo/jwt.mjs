// Chapter 5: what is inside the access token, and what happens when it is altered.
import { call, demoLogin, green, red, show } from './lib.mjs';

const token = await demoLogin();
const [header, payload] = token.split('.').slice(0, 2).map((x) => JSON.parse(Buffer.from(x, 'base64url')));
show('header', JSON.stringify(header));
show('payload.sub (userId)', payload.sub);
show('payload.iss / aud', `${payload.iss} / ${payload.aud}`);
show('hết hạn', `${new Date(payload.exp * 1000).toLocaleTimeString('vi-VN')} (${(payload.exp - payload.iat) / 60} phút)`);
const forged = token.slice(0, -2) + (token.at(-2) === 'A' ? 'B' : 'A') + token.at(-1);
show('gọi với token thật', green(String((await call('GET', '/api/task/tasks', { token })).status)));
const bad = await call('GET', '/api/task/tasks', { token: forged });
show('gọi với token bị sửa 1 ký tự', red(`${bad.status} ${bad.body.error.code}`));
