import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = (__ENV.BASE_URL || "http://localhost").replace(/\/$/, "");
const BENCH_MODE = (__ENV.BENCH_MODE || "standard").toLowerCase();
const BENCH_USERNAME = __ENV.BENCH_USERNAME || "";
const BENCH_PASSWORD = __ENV.BENCH_PASSWORD || "";

const WRITE_RATIO = envFloat("WRITE_RATIO", 0.15);
const SLEEP_SECONDS = envFloat("SLEEP_SECONDS", BENCH_MODE === "smoke" ? 0.25 : 0.1);
const ENABLE_LIST_WRITES = envBool("ENABLE_LIST_WRITES", false);

const MIXED_RATE = envInt("MIXED_RATE", BENCH_MODE === "smoke" ? 2 : 8);
const MIXED_DURATION = __ENV.MIXED_DURATION || (BENCH_MODE === "smoke" ? "4m" : "12m");
const MIXED_PREALLOCATED_VUS = envInt(
  "MIXED_PREALLOCATED_VUS",
  BENCH_MODE === "smoke" ? 8 : 30,
);
const MIXED_MAX_VUS = envInt("MIXED_MAX_VUS", BENCH_MODE === "smoke" ? 20 : 80);

const MICRO_RATE = envInt("MICRO_RATE", 3);
const MICRO_DURATION = __ENV.MICRO_DURATION || "90s";
const MICRO_STAGGER_SECONDS = envInt("MICRO_STAGGER_SECONDS", 95);
const MICRO_PREALLOCATED_VUS = envInt("MICRO_PREALLOCATED_VUS", 8);
const MICRO_MAX_VUS = envInt("MICRO_MAX_VUS", 30);

const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || "10s";

const MICRO_SCENARIOS = [
  { name: "health", exec: "micro_health", requiresAuth: false },
  { name: "anime_list", exec: "micro_anime_list", requiresAuth: false },
  { name: "anime_trending", exec: "micro_anime_trending", requiresAuth: false },
  { name: "anime_detail", exec: "micro_anime_detail", requiresAuth: false },
  { name: "forums_threads", exec: "micro_forums_threads", requiresAuth: false },
  { name: "users_me", exec: "micro_users_me", requiresAuth: true },
  { name: "users_me_stats", exec: "micro_users_me_stats", requiresAuth: true },
  {
    name: "notifications_mark_all_read",
    exec: "micro_notifications_mark_all_read",
    requiresAuth: true,
  },
];

export const options = buildOptions();

function buildOptions() {
  const thresholds = buildThresholds();

  if (BENCH_MODE === "micro") {
    const hasAuthCredentials = Boolean(BENCH_USERNAME && BENCH_PASSWORD);
    const selectedScenarios = MICRO_SCENARIOS.filter(
      (scenario) => !scenario.requiresAuth || hasAuthCredentials,
    );
    const scenarios = {};
    for (let i = 0; i < selectedScenarios.length; i += 1) {
      const micro = selectedScenarios[i];
      scenarios[`micro_${micro.name}`] = {
        executor: "constant-arrival-rate",
        exec: micro.exec,
        rate: MICRO_RATE,
        timeUnit: "1s",
        duration: MICRO_DURATION,
        startTime: `${i * MICRO_STAGGER_SECONDS}s`,
        preAllocatedVUs: MICRO_PREALLOCATED_VUS,
        maxVUs: MICRO_MAX_VUS,
      };
    }

    return {
      scenarios,
      thresholds,
      discardResponseBodies: false,
      summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
    };
  }

  return {
    scenarios: {
      mixed_api_benchmark: {
        executor: "constant-arrival-rate",
        exec: "mixedScenario",
        rate: MIXED_RATE,
        timeUnit: "1s",
        duration: MIXED_DURATION,
        preAllocatedVUs: MIXED_PREALLOCATED_VUS,
        maxVUs: MIXED_MAX_VUS,
      },
    },
    thresholds,
    discardResponseBodies: false,
    summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  };
}

function buildThresholds() {
  const smoke = BENCH_MODE === "smoke";

  return {
    checks: [smoke ? "rate>0.95" : "rate>0.97"],
    http_req_failed: [smoke ? "rate<0.05" : "rate<0.03"],

    "http_req_duration{api_group:core,op_type:read}": [smoke ? "p(95)<700" : "p(95)<500"],
    "http_req_duration{api_group:anime,op_type:read}": [smoke ? "p(95)<1500" : "p(95)<1200"],
    "http_req_duration{api_group:forums,op_type:read}": [smoke ? "p(95)<1500" : "p(95)<1200"],
    "http_req_duration{api_group:users,op_type:read}": [smoke ? "p(95)<1600" : "p(95)<1300"],
    "http_req_duration{api_group:users,op_type:write}": [smoke ? "p(95)<2000" : "p(95)<1600"],
  };
}

function envInt(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envFloat(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envBool(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function fullUrl(path) {
  return `${BASE_URL}${path}`;
}

function parseJson(response) {
  try {
    return response.json();
  } catch (_error) {
    return null;
  }
}

function extractResults(payload) {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload.results)) {
    return payload.results;
  }
  return [];
}

function authHeaders(token) {
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

function apiRequest(method, path, config = {}) {
  const {
    token,
    body,
    tags = {},
    expectedStatuses = [200],
  } = config;

  const headers = {
    Accept: "application/json",
    ...authHeaders(token),
  };

  let payload = null;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const params = {
    headers,
    timeout: REQUEST_TIMEOUT,
    tags: {
      mode: BENCH_MODE,
      ...tags,
    },
  };

  let response;
  if (method === "GET") {
    response = http.get(fullUrl(path), params);
  } else if (method === "POST") {
    response = http.post(fullUrl(path), payload, params);
  } else if (method === "PATCH") {
    response = http.patch(fullUrl(path), payload, params);
  } else if (method === "DELETE") {
    response = http.del(fullUrl(path), payload, params);
  } else {
    throw new Error(`Unsupported method: ${method}`);
  }

  check(response, {
    [`${method} ${path} expected status`]: (r) => expectedStatuses.includes(r.status),
  });

  return response;
}

function randomChance(probability) {
  return Math.random() < probability;
}

let vuState = null;

function benchmarkStateFromSetup(setupData) {
  return {
    token: setupData.token || "",
    authEnabled: Boolean(setupData.token),
    animeSlug: setupData.animeSlug || "",
    animeId: setupData.animeId || null,
    forumThreadId: setupData.forumThreadId || null,
    targetUsername: setupData.targetUsername || "",
    listEntryId: setupData.listEntryId || null,
    listWritesDisabled: false,
  };
}

function getVuState(setupData) {
  if (!vuState) {
    vuState = benchmarkStateFromSetup(setupData);
  }
  return vuState;
}

export function setup() {
  const state = {
    token: "",
    animeSlug: "",
    animeId: null,
    forumThreadId: null,
    targetUsername: "",
    listEntryId: null,
  };

  const animeListResponse = apiRequest("GET", "/api/v1/anime/?sort=popular&page=1", {
    tags: {
      api_group: "anime",
      endpoint_name: "anime_list",
      auth_type: "public",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
  const animeList = extractResults(parseJson(animeListResponse));
  if (animeList.length > 0) {
    state.animeSlug = animeList[0].slug || "";
    state.animeId = animeList[0].id || null;
  }

  const threadsResponse = apiRequest("GET", "/api/v1/forums/threads/?page=1", {
    tags: {
      api_group: "forums",
      endpoint_name: "forums_threads_list",
      auth_type: "public",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
  const threadList = extractResults(parseJson(threadsResponse));
  if (threadList.length > 0) {
    state.forumThreadId = threadList[0].id || null;
  }

  if (!BENCH_USERNAME || !BENCH_PASSWORD) {
    return state;
  }

  const loginResponse = apiRequest("POST", "/api/v1/auth/login/", {
    body: {
      username: BENCH_USERNAME,
      password: BENCH_PASSWORD,
    },
    tags: {
      api_group: "users",
      endpoint_name: "auth_login",
      auth_type: "public",
      op_type: "write",
    },
    expectedStatuses: [200],
  });

  const loginPayload = parseJson(loginResponse) || {};
  state.token = loginPayload.access || "";

  if (!state.token) {
    return state;
  }

  const usersResponse = apiRequest("GET", "/api/v1/users/?page=1", {
    token: state.token,
    tags: {
      api_group: "users",
      endpoint_name: "public_users_list",
      auth_type: "authenticated",
      op_type: "read",
    },
    expectedStatuses: [200],
  });

  const users = extractResults(parseJson(usersResponse));
  const candidate = users.find((user) => user && user.username && user.username !== BENCH_USERNAME);
  if (candidate) {
    state.targetUsername = candidate.username;
  }

  const listResponse = apiRequest("GET", "/api/v1/lists/?page=1", {
    token: state.token,
    tags: {
      api_group: "users",
      endpoint_name: "user_lists_list",
      auth_type: "authenticated",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
  const listItems = extractResults(parseJson(listResponse));
  if (listItems.length > 0) {
    state.listEntryId = listItems[0].id || null;
  }

  return state;
}

function runHealth(state) {
  return apiRequest("GET", "/api/v1/health/", {
    tags: {
      api_group: "core",
      endpoint_name: "health",
      auth_type: "public",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
}

function runAnimeList(state) {
  return apiRequest("GET", "/api/v1/anime/?sort=popular&page=1", {
    token: state.token,
    tags: {
      api_group: "anime",
      endpoint_name: "anime_list",
      auth_type: state.authEnabled ? "authenticated" : "public",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
}

function runAnimeTrending(state) {
  return apiRequest("GET", "/api/v1/anime/trending/", {
    tags: {
      api_group: "anime",
      endpoint_name: "anime_trending",
      auth_type: "public",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
}

function runAnimeDetail(state) {
  if (!state.animeSlug) {
    return null;
  }
  return apiRequest("GET", `/api/v1/anime/${state.animeSlug}/`, {
    token: state.token,
    tags: {
      api_group: "anime",
      endpoint_name: "anime_detail",
      auth_type: state.authEnabled ? "authenticated" : "public",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
}

function runAnimeRelated(state) {
  if (!state.animeSlug) {
    return null;
  }
  return apiRequest("GET", `/api/v1/anime/${state.animeSlug}/related/`, {
    tags: {
      api_group: "anime",
      endpoint_name: "anime_related",
      auth_type: "public",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
}

function runForumsThreads(state) {
  return apiRequest("GET", "/api/v1/forums/threads/?page=1", {
    tags: {
      api_group: "forums",
      endpoint_name: "forums_threads_list",
      auth_type: "public",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
}

function runForumsThreadDetail(state) {
  if (!state.forumThreadId) {
    return null;
  }
  return apiRequest("GET", `/api/v1/forums/threads/${state.forumThreadId}/`, {
    token: state.token,
    tags: {
      api_group: "forums",
      endpoint_name: "forums_thread_detail",
      auth_type: state.authEnabled ? "authenticated" : "public",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
}

function runUsersMe(state) {
  if (!state.authEnabled) {
    return null;
  }
  return apiRequest("GET", "/api/v1/users/me/", {
    token: state.token,
    tags: {
      api_group: "users",
      endpoint_name: "users_me",
      auth_type: "authenticated",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
}

function runUsersMeStats(state) {
  if (!state.authEnabled) {
    return null;
  }
  return apiRequest("GET", "/api/v1/users/me/stats/", {
    token: state.token,
    tags: {
      api_group: "users",
      endpoint_name: "users_me_stats",
      auth_type: "authenticated",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
}

function runNotificationsUnreadCount(state) {
  if (!state.authEnabled) {
    return null;
  }
  return apiRequest("GET", "/api/v1/notifications/unread_count/", {
    token: state.token,
    tags: {
      api_group: "users",
      endpoint_name: "notifications_unread_count",
      auth_type: "authenticated",
      op_type: "read",
    },
    expectedStatuses: [200],
  });
}

function runNotificationsMarkAllRead(state) {
  if (!state.authEnabled) {
    return null;
  }
  return apiRequest("POST", "/api/v1/notifications/mark_all_read/", {
    token: state.token,
    body: {},
    tags: {
      api_group: "users",
      endpoint_name: "notifications_mark_all_read",
      auth_type: "authenticated",
      op_type: "write",
    },
    expectedStatuses: [200],
  });
}

function runFollowsToggle(state) {
  if (!state.authEnabled || !state.targetUsername) {
    return null;
  }
  return apiRequest("POST", "/api/v1/follows/toggle/", {
    token: state.token,
    body: {
      username: state.targetUsername,
    },
    tags: {
      api_group: "users",
      endpoint_name: "follows_toggle",
      auth_type: "authenticated",
      op_type: "write",
    },
    expectedStatuses: [200, 201],
  });
}

function runOptionalListWriteCycle(state) {
  if (!ENABLE_LIST_WRITES || !state.authEnabled || !state.animeId || state.listWritesDisabled) {
    return;
  }

  if (state.listEntryId) {
    apiRequest("PATCH", `/api/v1/lists/${state.listEntryId}/`, {
      token: state.token,
      body: {
        episodes_watched: 1,
      },
      tags: {
        api_group: "users",
        endpoint_name: "user_lists_update",
        auth_type: "authenticated",
        op_type: "write",
      },
      expectedStatuses: [200],
    });

    if (randomChance(0.1)) {
      const deleteResponse = apiRequest("DELETE", `/api/v1/lists/${state.listEntryId}/`, {
        token: state.token,
        tags: {
          api_group: "users",
          endpoint_name: "user_lists_delete",
          auth_type: "authenticated",
          op_type: "write",
        },
        expectedStatuses: [204],
      });
      if (deleteResponse.status === 204) {
        state.listEntryId = null;
      }
    }

    return;
  }

  const createResponse = apiRequest("POST", "/api/v1/lists/", {
    token: state.token,
    body: {
      anime_id: state.animeId,
      status: "Watching",
      episodes_watched: 1,
    },
    tags: {
      api_group: "users",
      endpoint_name: "user_lists_create",
      auth_type: "authenticated",
      op_type: "write",
    },
    expectedStatuses: [201, 400, 403],
  });

  if (createResponse.status === 403) {
    state.listWritesDisabled = true;
    return;
  }

  if (createResponse.status === 201) {
    const payload = parseJson(createResponse) || {};
    if (payload.id) {
      state.listEntryId = payload.id;
    }
  }

  if (createResponse.status === 400) {
    const listResponse = apiRequest("GET", "/api/v1/lists/?page=1", {
      token: state.token,
      tags: {
        api_group: "users",
        endpoint_name: "user_lists_list",
        auth_type: "authenticated",
        op_type: "read",
      },
      expectedStatuses: [200],
    });
    const listItems = extractResults(parseJson(listResponse));
    if (listItems.length > 0 && listItems[0].id) {
      state.listEntryId = listItems[0].id;
    }
  }
}

function runMixedIteration(rawSetupData) {
  const state = getVuState(rawSetupData);

  runHealth(state);
  runAnimeList(state);
  runAnimeTrending(state);

  if (randomChance(0.6)) {
    runAnimeDetail(state);
  }
  if (randomChance(0.3)) {
    runAnimeRelated(state);
  }

  runForumsThreads(state);
  if (randomChance(0.35)) {
    runForumsThreadDetail(state);
  }

  runUsersMe(state);
  if (randomChance(0.5)) {
    runUsersMeStats(state);
  }
  if (randomChance(0.5)) {
    runNotificationsUnreadCount(state);
  }

  if (randomChance(WRITE_RATIO)) {
    runNotificationsMarkAllRead(state);
  }
  if (randomChance(WRITE_RATIO * 0.6)) {
    runFollowsToggle(state);
  }
  if (randomChance(WRITE_RATIO * 0.5)) {
    runOptionalListWriteCycle(state);
  }

  sleep(SLEEP_SECONDS);
}

export function mixedScenario(setupData) {
  runMixedIteration(setupData);
}

export default function (setupData) {
  runMixedIteration(setupData);
}

export function micro_health(setupData) {
  const state = getVuState(setupData);
  runHealth(state);
  sleep(SLEEP_SECONDS);
}

export function micro_anime_list(setupData) {
  const state = getVuState(setupData);
  runAnimeList(state);
  sleep(SLEEP_SECONDS);
}

export function micro_anime_trending(setupData) {
  const state = getVuState(setupData);
  runAnimeTrending(state);
  sleep(SLEEP_SECONDS);
}

export function micro_anime_detail(setupData) {
  const state = getVuState(setupData);
  runAnimeDetail(state);
  sleep(SLEEP_SECONDS);
}

export function micro_forums_threads(setupData) {
  const state = getVuState(setupData);
  runForumsThreads(state);
  sleep(SLEEP_SECONDS);
}

export function micro_users_me(setupData) {
  const state = getVuState(setupData);
  runUsersMe(state);
  sleep(SLEEP_SECONDS);
}

export function micro_users_me_stats(setupData) {
  const state = getVuState(setupData);
  runUsersMeStats(state);
  sleep(SLEEP_SECONDS);
}

export function micro_notifications_mark_all_read(setupData) {
  const state = getVuState(setupData);
  runNotificationsMarkAllRead(state);
  sleep(SLEEP_SECONDS);
}
