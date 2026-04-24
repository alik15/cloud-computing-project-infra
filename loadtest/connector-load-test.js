// connector-load-test.js
// Tests the Go connector directly (bypassing Django)
// Run locally: k6 run connector-load-test.js
// Run against GKE: k6 run -e BASE_URL=http://CONNECTOR_IP:8080 connector-load-test.js
//
// To expose connector locally for testing:
//   kubectl port-forward -n appns svc/connector-svc 8080:8080

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ── Custom metrics ────────────────────────────────────────────────────────────
const errorRate    = new Rate('error_rate');
const movieSaveTrend = new Trend('movie_save_duration');
const movieGetTrend  = new Trend('movie_get_duration');

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://34.45.77.149:8080';

export const options = {
  stages: [
    { duration: '30s', target: 200  },  // ramp up to 10 users
    { duration: '1m',  target: 300  },  // hold at 10
    { duration: '30s', target: 1000  },  // ramp up to 50
    { duration: '1m',  target: 500  },  // hold at 50
    { duration: '30s', target: 1000 },  // ramp up to 100
    { duration: '1m',  target: 1000 },  // hold at 100
    { duration: '30s', target: 0   },  // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95% of requests under 500ms
    error_rate:        ['rate<0.05'],   // less than 5% errors
    movie_get_duration:  ['p(95)<300'],
    movie_save_duration: ['p(95)<500'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const headers = {
  'Content-Type': 'application/json',
  'X-User-ID': `${Math.floor(Math.random() * 100) + 1}`,  // simulate multiple users
  'X-Username': 'loadtest',
};

function randomTitle() {
  const titles = [
    'The Dark Knight', 'Inception', 'Interstellar', 'The Matrix',
    'Pulp Fiction', 'Fight Club', 'Goodfellas', 'The Godfather',
    'Schindler\'s List', 'Forrest Gump',
  ];
  return titles[Math.floor(Math.random() * titles.length)] + ' ' + Date.now();
}

// ── Test scenarios ────────────────────────────────────────────────────────────
export default function () {

  group('health check', () => {
    const res = http.get(`${BASE_URL}/health`, { headers });
    check(res, {
      'health status 200': (r) => r.status === 200,
      'health returns ok':  (r) => r.json('status') === 'ok',
    });
    errorRate.add(res.status !== 200);
  });

  sleep(0.5);

  group('GET movies', () => {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/movies`, { headers });
    movieGetTrend.add(Date.now() - start);

    check(res, {
      'get movies status 200': (r) => r.status === 200,
      'get movies returns array': (r) => Array.isArray(r.json()),
    });
    errorRate.add(res.status !== 200);
  });

  sleep(0.5);

  group('POST movie', () => {
    const payload = JSON.stringify({
      title:   randomTitle(),
      year:    '2024',
      genre:   'Action',
      watched: false,
    });

    const start = Date.now();
    const res = http.post(`${BASE_URL}/movies`, payload, { headers });
    movieSaveTrend.add(Date.now() - start);

    const saved = check(res, {
      'post movie status 201':    (r) => r.status === 201,
      'post movie has id':        (r) => r.json('id') > 0,
      'post movie has title':     (r) => r.json('title') !== '',
      'post movie has user_id':   (r) => r.json('user_id') !== '',
    });
    errorRate.add(!saved);

    // If saved successfully test PATCH and DELETE
    if (saved) {
      const movieId = res.json('id');
      sleep(0.2);

      group('PATCH movie', () => {
        const patchRes = http.patch(
          `${BASE_URL}/movies/${movieId}`,
          JSON.stringify({ my_rating: 8, watched: true }),
          { headers }
        );
        check(patchRes, {
          'patch movie status 200':  (r) => r.status === 200,
          'patch movie updated':     (r) => r.json('my_rating') === 8,
        });
        errorRate.add(patchRes.status !== 200);
      });

      sleep(0.2);

      group('DELETE movie', () => {
        const delRes = http.del(`${BASE_URL}/movies/${movieId}`, null, { headers });
        check(delRes, {
          'delete movie status 200': (r) => r.status === 200,
        });
        errorRate.add(delRes.status !== 200);
      });
    }
  });

  sleep(1);
}

// ── Summary ───────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  return {
    'connector-load-summary.json': JSON.stringify(data, null, 2),
    stdout: `
╔══════════════════════════════════════════════════════╗
║           CONNECTOR LOAD TEST SUMMARY                ║
╠══════════════════════════════════════════════════════╣
║ Total requests:  ${data.metrics.http_reqs.values.count}
║ Failed requests: ${data.metrics.http_req_failed.values.count}
║ Error rate:      ${(data.metrics.error_rate?.values.rate * 100).toFixed(2)}%
║ Avg response:    ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms
║ p95 response:    ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms
║ GET movies p95:  ${data.metrics.movie_get_duration?.values['p(95)']?.toFixed(2)}ms
║ POST movie p95:  ${data.metrics.movie_save_duration?.values['p(95)']?.toFixed(2)}ms
╚══════════════════════════════════════════════════════╝
    `,
  };
}

