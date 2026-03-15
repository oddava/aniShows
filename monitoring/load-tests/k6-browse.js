import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost";

export const options = {
  scenarios: {
    browse_read_heavy: {
      executor: "ramping-vus",
      startVUs: 100,
      stages: [
        { duration: "3m", target: 1000 },
        { duration: "5m", target: 5000 },
        { duration: "5m", target: 10000 },
        { duration: "2m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500", "p(99)<1200"],
  },
};

function get(path) {
  return http.get(`${BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
    },
    timeout: "10s",
  });
}

export default function () {
  const health = get("/api/v1/health/");
  check(health, { "health status 200": (r) => r.status === 200 });

  const list = get("/api/v1/anime/?sort=popular&page=1");
  check(list, { "anime list status 200": (r) => r.status === 200 });

  const trending = get("/api/v1/anime/trending/");
  check(trending, { "trending status 200": (r) => r.status === 200 });

  const topRated = get("/api/v1/anime/top_rated/");
  check(topRated, { "top rated status 200": (r) => r.status === 200 });

  const forums = get("/api/v1/forums/threads/?page=1");
  check(forums, { "forums status 200": (r) => r.status === 200 });

  sleep(1);
}
