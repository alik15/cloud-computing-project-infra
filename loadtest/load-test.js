import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 200 },
    { duration: '1m',  target: 400 },
    { duration: '1m', target: 500 }, 
    { duration: '1m',  target: 500 },
    { duration: '30s', target: 0 }, 
  ],
};

//const BASE_URL = 'http://192.168.18.41:30080';
const BASE_URL = 'http://34.45.77.149';

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health status 200': (r) => r.status === 200 });

  const login = http.get(`${BASE_URL}/login`);
  check(login, { 'login page loads': (r) => r.status === 200 });

  sleep(1);
}
