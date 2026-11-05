import { createMp4Exporter } from "./mp4-export.mjs";
var _a;
import http from "node:http";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join, resolve, extname } from "node:path";
import { performance } from "node:perf_hooks";
const WIDTH = 91.4, HEIGHT = 55;
class Session {
  constructor(code = randomBytes(3).toString("hex").toUpperCase()) {
    this.claims = /* @__PURE__ */ new Map();
    this.state = {
      code,
      paused: false,
      ended: false,
      players: [],
      ball: { x: WIDTH / 2, y: HEIGHT / 2 }
    };
    this.reset();
  }
  reset() {
    const positions = [
      [3, 27.5],
      [15, 8],
      [12, 21],
      [12, 34],
      [15, 47],
      [27, 12],
      [25, 27.5],
      [27, 43],
      [39, 9],
      [40, 27.5],
      [39, 46]
    ];
    this.state.players = ["A", "B"].flatMap(
      (team) => positions.map(([x, y], i) => {
        const id = team + (i + 1), old = this.state.players.find((p) => p.id === id);
        return {
          id,
          number: i + 1,
          team,
          name: (old == null ? void 0 : old.name) || `Player ${i + 1}`,
          x: team === "A" ? x : WIDTH - x,
          y: team === "A" ? y : HEIGHT - y,
          claimed: (old == null ? void 0 : old.claimed) || false,
          locked: (old == null ? void 0 : old.locked) || false
        };
      })
    );
    this.state.ball = { x: WIDTH / 2, y: HEIGHT / 2 };
    this.stop();
  }
  setPossession(playerId) {
    const p = this.state.players.find(p => p.id === playerId);
    if (!p) throw Error("Player not found.");
    this.state.ball = { x: p.x, y: Math.min(HEIGHT, p.y + 0.8), ownerId: p.id, targetId: null };
  }
  collect(token) {
    const c = this.claims.get(token), p = this.state.players.find(p => p.id === c?.playerId);
    if (!p || this.state.paused || this.state.ended || p.locked) throw Error("You cannot collect the ball now.");
    const ball = this.state.ball;
    if (ball.ownerId || ball.targetId) throw Error("The ball is already in play.");
    if (Math.hypot(p.x - ball.x, p.y - ball.y) > 3) throw Error("Move within 3 metres of the ball to collect it.");
    this.setPossession(p.id);
  }
  pass(token, targetId) {
    const c = this.claims.get(token), p = this.state.players.find(p => p.id === c?.playerId);
    const target = this.state.players.find(p => p.id === targetId);
    if (!p || this.state.paused || this.state.ended || p.locked) throw Error("You cannot pass now.");
    if (this.state.ball.ownerId !== p.id) throw Error("You need possession to pass.");
    if (!target || target.id === p.id || target.team !== p.team || !target.claimed || target.locked) throw Error("Choose a connected, unlocked teammate.");
    this.state.ball.ownerId = null;
    this.state.ball.targetId = target.id;
  }
  stop() {
    for (const c of this.claims.values()) {
      c.x = 0;
      c.y = 0;
    }
  }
  claim(playerId, name) {
    if (this.state.ended) throw Error("This session has ended.");
    const p = this.state.players.find((p2) => p2.id === playerId);
    if (!p || p.claimed) throw Error("That position is unavailable.");
    if (typeof name !== "string" || !name.trim() || name.length > 40)
      throw Error("Enter a name of 1–40 characters.");
    const token = randomBytes(32).toString("hex");
    p.claimed = true;
    p.name = name.trim();
    this.claims.set(token, { playerId, x: 0, y: 0, at: 0, seq: -1 });
    return token;
  }
  input(token, x, y, seq, now) {
    const c = this.claims.get(token);
    if (!c) throw Error("Join a position first.");
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isSafeInteger(seq) || seq < 0)
      throw Error("Invalid movement.");
    if (seq <= c.seq) return;
    c.seq = seq;
    c.at = now;
    const p = this.state.players.find((p2) => p2.id === c.playerId);
    const length = Math.max(1, Math.hypot(x, y));
    c.x = this.state.paused || this.state.ended || p.locked ? 0 : x / length;
    c.y = this.state.paused || this.state.ended || p.locked ? 0 : y / length;
  }
  release(token) {
    const c = this.claims.get(token);
    if (!c) throw Error("Position already released.");
    const p = this.state.players.find((p2) => p2.id === c.playerId);
    p.claimed = false;
    p.name = `Player ${p.number}`;
    this.claims.delete(token);
    if (this.state.ball.ownerId === p.id) this.state.ball.ownerId = null;
    if (this.state.ball.targetId === p.id) this.state.ball.targetId = null;
  }
  tick(seconds, now) {
    if (this.state.paused || this.state.ended) return;
    const dt = Math.max(0, Math.min(0.1, seconds));
    for (const c of this.claims.values()) {
      if (now - c.at > 300) {
        c.x = 0;
        c.y = 0;
        continue;
      }
      const p = this.state.players.find((p2) => p2.id === c.playerId);
      if (p.locked) continue;
      p.x = Math.max(0, Math.min(WIDTH, p.x + c.x * 6 * dt));
      p.y = Math.max(0, Math.min(HEIGHT, p.y + c.y * 6 * dt));
    }
    const ball = this.state.ball;
    if (ball.ownerId) {
      const owner = this.state.players.find(p => p.id === ball.ownerId);
      if (owner) { ball.x = owner.x; ball.y = Math.min(HEIGHT, owner.y + 0.8); }
    } else if (ball.targetId) {
      const target = this.state.players.find(p => p.id === ball.targetId);
      if (!target?.claimed) { ball.targetId = null; return; }
      const dx = target.x - ball.x, dy = Math.min(HEIGHT, target.y + 0.8) - ball.y;
      const distance = Math.hypot(dx, dy), step = 22 * dt;
      if (distance <= step) this.setPossession(target.id);
      else { ball.x += dx / distance * step; ball.y += dy / distance * step; }
    }
  }
}
class Recordings {
  constructor(dir) {
    this.dir = dir;
    this.summaries = /* @__PURE__ */ new Map();
    this.active = null;
    this.started = 0;
    this.last = -Infinity;
    mkdirSync(dir, { recursive: true, mode: 448 });
    for (const file of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      try {
        const recording = JSON.parse(
          readFileSync(join(dir, file), "utf8")
        );
        this.summaries.set(recording.id, this.summary(recording));
      } catch {
      }
    }
  }
  start(state, teamName, now) {
    if (this.active) throw Error("A recording is already running.");
    this.started = now;
    this.last = -Infinity;
    this.active = {
      id: randomUUID(),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      teamName,
      code: state.code,
      duration: 0,
      frames: []
    };
    this.sample(state, now);
  }
  sample(state, now) {
    if (!this.active || now - this.last < 100) return;
    this.last = now;
    this.active.frames.push({
      at: Math.max(0, now - this.started),
      state: structuredClone(state)
    });
    this.active.duration = Math.max(0, now - this.started);
  }
  stop(state, now) {
    if (!this.active) throw Error("No recording is running.");
    this.last = -Infinity;
    this.sample(state, now);
    const recording = this.active;
    const path = join(this.dir, recording.id + ".json");
    writeFileSync(path + ".tmp", JSON.stringify(recording), { mode: 384 });
    renameSync(path + ".tmp", path);
    this.active = null;
    this.summaries.set(recording.id, this.summary(recording));
    return this.summary(recording);
  }
  summary(r) {
    return {
      id: r.id,
      createdAt: r.createdAt,
      teamName: r.teamName,
      code: r.code,
      duration: r.duration
    };
  }
  list() {
    return [...this.summaries.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt)
    );
  }
  read(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid recording.");
    const path = join(this.dir, id + ".json");
    if (!existsSync(path)) throw Error("Recording not found.");
    return JSON.parse(readFileSync(path, "utf8"));
  }
}
async function startServer({
  port = Number(process.env.PORT || 3e3),
  dataDir = process.env.PRESSPLAYSIM_DATA_DIR || join(homedir(), "Library/Application Support/PressPlaySim"),
  staticDir = resolve("dist"),
  dev = process.env.NODE_ENV !== "production"
} = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 448 });
  const profileFile = join(dataDir, "staff.json");
  const brandFile = join(dataDir, "brand.json");
  let brand = existsSync(brandFile) ? JSON.parse(readFileSync(brandFile, "utf8")) : { name: "Your club", primary: "#007f91" };
  const recordings = new Recordings(join(dataDir, "recordings"));
  const downloadMp4 = createMp4Exporter(dataDir, join(import.meta.dirname, "..", "native", "pressplay-mp4-export"));
  let recordingError = "";
  let profile = existsSync(profileFile) ? JSON.parse(readFileSync(profileFile, "utf8")) : null;
  let session = null;
  const staffTokens = /* @__PURE__ */ new Set();
  const clients = /* @__PURE__ */ new Set();
  const attempts = /* @__PURE__ */ new Map();
  let activePort = port;
  const addresses = () => Object.values(networkInterfaces()).flat().filter((n) => (n == null ? void 0 : n.family) === "IPv4" && !n.internal).map((n) => n.address);
  const local = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
    req.socket.remoteAddress || ""
  );
  const bearer = (req) => {
    var _a2;
    return ((_a2 = req.headers.authorization) == null ? void 0 : _a2.replace(/^Bearer /, "")) || "";
  };
  const server = http.createServer();
  const vite = dev ? await (await import("vite")).createServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa"
  }) : null;
  const send = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(body));
  };
  const broadcast = () => {
    if (session)
      for (const res of clients) {
        if (res.writableLength > 256e3) {
          res.destroy();
          clients.delete(res);
        } else res.write(`data: ${JSON.stringify(session.state)}

`);
      }
  };
  server.on("request", async (req, res) => {
    var _a2;
    try {
      const host = req.headers.host || "";
      if (!["localhost", "127.0.0.1", ...addresses()].some(
        (h) => host === `${h}:${activePort}`
      )) {
        send(res, 403, { error: "Use the displayed local address." });
        return;
      }
      const url = new URL(req.url || "/", `http://${host}`);
      if (!url.pathname.startsWith("/api/")) {
        if (vite) {
          vite.middlewares(req, res);
          return;
        }
        const root = resolve(staticDir);
        const path = resolve(root, "." + decodeURIComponent(url.pathname));
        if (!path.startsWith(root + "/") && path !== root) {
          send(res, 403, { error: "Forbidden" });
          return;
        }
        const file = existsSync(path) && statSync(path).isFile() ? path : join(root, "index.html");
        const mime = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".jpg": "image/jpeg"
        };
        res.writeHead(200, {
          "Content-Type": mime[extname(file)] || "application/octet-stream"
        });
        res.end(readFileSync(file));
        return;
      }
      if (req.headers.origin && req.headers.origin !== `http://${host}`) {
        send(res, 403, { error: "Cross-origin request rejected." });
        return;
      }
      const staff = local(req) && staffTokens.has(bearer(req));
      if (req.method === "GET" && url.pathname === "/api/info") {
        send(res, 200, {
          configured: !!profile,
          brand,
          local: local(req),
          name: staff ? profile == null ? void 0 : profile.name : null,
          urls: staff ? addresses().map((ip) => `http://${ip}:${activePort}`) : []
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/staff/session") {
        if (!staff) {
          send(res, 401, { error: "Sign in on the host Mac." });
          return;
        }
        send(res, 200, (session == null ? void 0 : session.state) || null);
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/staff/recordings")) {
        if (!staff) {
          send(res, 401, { error: "Sign in on the host Mac." });
          return;
        }
        const video = url.pathname.match(/^\/api\/staff\/recordings\/([a-f0-9-]{36})\/mp4$/);
        if (video) {
          const recording = recordings.read(video[1]);
          await downloadMp4(req, res, video[1], recording);
          return;
        }
        if (url.pathname === "/api/staff/recordings")
          send(res, 200, {
            items: recordings.list(),
            active: recordings.active ? recordings.summary(recordings.active) : null,
            error: recordingError
          });
        else send(res, 200, recordings.read(url.pathname.split("/").pop()));
        return;
      }
      const match = url.pathname.match(
        /^\/api\/sessions\/([A-F0-9]{6})(?:\/(\w+))?$/
      );
      if (req.method === "GET" && match) {
        if (!session || session.state.code !== match[1]) {
          send(res, 404, { error: "Session not found." });
          return;
        }
        if (match[2] === "events") {
          if (clients.size >= 100) {
            send(res, 503, { error: "Connection limit reached." });
            return;
          }
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          });
          res.write(`data: ${JSON.stringify(session.state)}

`);
          clients.add(res);
          req.on("close", () => clients.delete(res));
          return;
        }
        if (!match[2]) {
          send(res, 200, session.state);
          return;
        }
      }
      if (req.method !== "POST") {
        send(res, 404, { error: "Not found." });
        return;
      }
      if (!((_a2 = req.headers["content-type"]) == null ? void 0 : _a2.startsWith("application/json"))) {
        send(res, 415, { error: "JSON required." });
        return;
      }
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 8192) {
          send(res, 413, { error: "Request too large." });
          return;
        }
      }
      let body;
      try {
        body = JSON.parse(raw || "{}");
        if (!body || typeof body !== "object") throw Error();
      } catch {
        send(res, 400, { error: "Invalid JSON." });
        return;
      }
      if (url.pathname === "/api/staff/login") {
        if (!local(req)) {
          send(res, 403, {
            error: "Staff sign-in is available only on the host Mac."
          });
          return;
        }
        const key = req.socket.remoteAddress || "";
        const now = Date.now();
        let rate = attempts.get(key);
        if (!rate || now - rate.since > 6e4) {
          rate = { count: 0, since: now };
          attempts.set(key, rate);
        }
        if (++rate.count > 10) {
          send(res, 429, { error: "Wait a minute before trying again." });
          return;
        }
        if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) {
          send(res, 400, { error: "Use a password of 8–128 characters." });
          return;
        }
        if (!profile) {
          if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 60) {
            send(res, 400, { error: "Enter your staff name." });
            return;
          }
          const salt = randomBytes(16).toString("hex");
          profile = {
            name: body.name.trim(),
            salt,
            hash: scryptSync(body.password, salt, 64).toString("hex")
          };
          writeFileSync(profileFile + ".tmp", JSON.stringify(profile), {
            mode: 384
          });
          renameSync(profileFile + ".tmp", profileFile);
        } else if (!timingSafeEqual(
          Buffer.from(profile.hash, "hex"),
          scryptSync(body.password, profile.salt, 64)
        )) {
          send(res, 401, { error: "Incorrect password." });
          return;
        }
        const token = randomBytes(32).toString("hex");
        staffTokens.add(token);
        send(res, 200, { token, name: profile.name });
        return;
      }
      if (url.pathname.startsWith("/api/staff/")) {
        if (!staff) {
          send(res, 401, { error: "Sign in on the host Mac." });
          return;
        }
        if (url.pathname === "/api/staff/brand") {
          if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 60 || !/^#[0-9a-fA-F]{6}$/.test(body.primary))
            throw Error("Enter a club name and a valid colour.");
          brand = { name: body.name.trim(), primary: body.primary };
          writeFileSync(brandFile + ".tmp", JSON.stringify(brand), {
            mode: 384
          });
          renameSync(brandFile + ".tmp", brandFile);
          send(res, 200, brand);
          return;
        }
        if (url.pathname === "/api/staff/record") {
          if (!session || session.state.ended)
            throw Error("Create a live session first.");
          if (body.action === "start")
            recordings.start(session.state, brand.name, performance.now());
          else if (body.action === "stop")
            recordings.stop(session.state, performance.now());
          else throw Error("Unknown recording action.");
          recordingError = "";
          send(res, 200, {
            items: recordings.list(),
            active: recordings.active ? recordings.summary(recordings.active) : null,
            error: recordingError
          });
          return;
        }
        if (url.pathname === "/api/staff/logout") {
          staffTokens.delete(bearer(req));
          send(res, 200, { ok: true });
          return;
        }
        if (url.pathname === "/api/staff/create") {
          if (session && !session.state.ended) {
            send(res, 409, { error: "End the current session first." });
            return;
          }
          for (const c of clients) c.end();
          clients.clear();
          session = new Session();
          send(res, 200, session.state);
          return;
        }
        if (url.pathname === "/api/staff/control" && session) {
          const s = session.state;
          if (body.action === "pause") {
            s.paused = !s.paused;
            session.stop();
          } else if (body.action === "reset") {
            session.reset();
          } else if (body.action === "end") {
            if (recordings.active) recordings.stop(s, performance.now());
            s.ended = true;
            s.paused = true;
            session.stop();
          } else if (body.action === "lock") {
            const p = s.players.find((p2) => p2.id === body.id);
            if (!p) throw Error("Player not found.");
            p.locked = !p.locked;
            session.stop();
          } else if (body.action === "possession") {
            session.setPossession(body.id);
          } else if (body.action === "move") {
            if (!Number.isFinite(body.x) || !Number.isFinite(body.y))
              throw Error("Invalid position.");
            const target = body.id === "ball" ? s.ball : s.players.find((p) => p.id === body.id);
            if (!target) throw Error("Marker not found.");
            if (body.id === "ball") { s.ball.ownerId = null; s.ball.targetId = null; }
            target.x = Math.max(0, Math.min(91.4, body.x));
            target.y = Math.max(0, Math.min(55, body.y));
            if (body.id !== "ball") {
              for (const claim of session.claims.values())
                if (claim.playerId === body.id) {
                  claim.x = 0;
                  claim.y = 0;
                }
            }
          } else throw Error("Unknown control.");
          broadcast();
          send(res, 200, s);
          return;
        }
      }
      if (match && session && session.state.code === match[1]) {
        if (session.state.ended) {
          send(res, 409, { error: "This session has ended." });
          return;
        }
        if (match[2] === "claim") {
          const token2 = session.claim(body.playerId, body.name);
          broadcast();
          send(res, 200, { token: token2, playerId: body.playerId, seq: 0 });
          return;
        }
        const token = bearer(req);
        const claim = session.claims.get(token);
        if (!claim) {
          send(res, 401, {
            error: "Your position is no longer assigned. Join again."
          });
          return;
        }
        if (match[2] === "resume") {
          send(res, 200, { playerId: claim.playerId, seq: claim.seq + 1 });
          return;
        }
        if (match[2] === "pass" || match[2] === "collect") {
          if (match[2] === "pass") session.pass(token, body.targetId);
          else session.collect(token);
          broadcast();
          send(res, 200, { ok: true });
          return;
        }
        if (match[2] === "input") {
          session.input(token, body.x, body.y, body.seq, performance.now());
          send(res, 200, { ok: true });
          return;
        }
        if (match[2] === "leave") {
          session.release(token);
          broadcast();
          send(res, 200, { ok: true });
          return;
        }
      }
      send(res, 404, { error: "Not found." });
    } catch (error) {
      if (!res.headersSent)
        send(res, 400, {
          error: error instanceof Error ? error.message : "Request failed."
        });
      else res.end();
    }
  });
  let last = performance.now();
  const tick = setInterval(() => {
    const now = performance.now();
    session == null ? void 0 : session.tick((now - last) / 1e3, now);
    last = now;
    if (session && recordings.active) {
      if (recordings.active.duration < 30 * 60 * 1e3)
        recordings.sample(session.state, now);
      if (recordings.active.duration >= 30 * 60 * 1e3 && !recordingError) {
        try {
          recordings.stop(session.state, now);
        } catch (e) {
          recordingError = "Could not save recording: " + e.message;
        }
      }
    }
    broadcast();
  }, 50);
  await new Promise((resolve2, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      const address = server.address();
      activePort = typeof address === "object" && address ? address.port : port;
      resolve2();
    });
  });
  console.log(`PressPlaySim: http://localhost:${activePort}`);
  return {
    server,
    port: activePort,
    close: async () => {
      clearInterval(tick);
      if (session && recordings.active)
        recordings.stop(session.state, performance.now());
      for (const c of clients) c.end();
      await (vite == null ? void 0 : vite.close());
      await new Promise((r) => server.close(() => r()));
    }
  };
}
if ((_a = process.argv[1]) == null ? void 0 : _a.endsWith("/server/index.ts"))
  startServer().then((app) => {
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      try {
        await app.close();
        process.exit(0);
      } catch (e) {
        console.error("Could not save before shutdown", e);
        process.exit(1);
      }
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
export {
  startServer
};
