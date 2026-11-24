"use strict";

const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const browserCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

// The library's default page is no longer on disk, so it loads live WhatsApp Web.
// That current page never finishes the login socket, and the client gives up after 30s.
// This HTML is the page that produced a QR code on this machine.
const webCacheDir = path.join(__dirname, "..", ".wwebjs_cache");
const webVersion = "2.3000.1055798384";

function findBrowser() {
  return browserCandidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function groupIdFromChats(chats, name) {
  const wanted = String(name || "").trim();
  const wantedFold = wanted.toLowerCase();
  let folded = "";
  for (const chat of chats || []) {
    const id = typeof chat.id === "string" ? chat.id : chat.id?._serialized || "";
    if (!id) continue;
    const isGroup = Boolean(chat.isGroup) || id.endsWith("@g.us") || Boolean(chat.subject);
    if (!isGroup) continue;
    const titles = [chat.name, chat.formattedTitle, chat.subject]
      .map((title) => String(title || "").trim())
      .filter(Boolean);
    if (titles.includes(wanted)) return id;
    if (!folded && titles.some((title) => title.toLowerCase() === wantedFold)) folded = id;
  }
  return folded;
}

function createWhatsApp(sessionId) {
  const executablePath = findBrowser();
  const label = String(sessionId || "default").slice(0, 8);
  const puppeteer = {
    headless: true,
    protocolTimeout: 180000,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  };
  if (executablePath) puppeteer.executablePath = executablePath;

  const pinnedPage = path.join(webCacheDir, `${webVersion}.html`);
  if (!fs.existsSync(pinnedPage)) {
    console.log(`[whatsapp ${label}] missing pinned WhatsApp page ${pinnedPage}`);
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath: path.join(__dirname, "..", ".wwebjs_auth"),
    }),
    authTimeoutMs: 120000,
    webVersion,
    webVersionCache: {
      type: "local",
      path: webCacheDir,
    },
    puppeteer,
  });

  const state = {
    status: "starting",
    qrDataUrl: "",
    detail: executablePath ? "" : "Install Google Chrome, then start this page again.",
  };

  const publish = (status, detail = "") => {
    state.status = status;
    state.detail = detail;
    if (status !== "qr") state.qrDataUrl = "";
    console.log(`[whatsapp ${label}] ${status}${detail ? `: ${detail}` : ""}`);
  };

  client.on("qr", async (qr) => {
    try {
      state.qrDataUrl = await qrcode.toDataURL(qr);
      state.status = "qr";
      state.detail = "Scan this QR code with the WhatsApp account that will create the groups.";
      console.log(`[whatsapp ${label}] qr`);
    } catch (error) {
      publish("disconnected", error.message);
    }
  });

  client.on("authenticated", () => {
    publish("starting", "Phone accepted the login. Waiting for WhatsApp Web.");
  });

  client.on("ready", () => {
    publish("ready", "Connected.");
  });

  client.on("auth_failure", (message) => {
    publish("disconnected", String(message || "Authentication failed"));
  });

  client.on("disconnected", (reason) => {
    publish("disconnected", String(reason || "Disconnected"));
  });

  client.initialize().catch(async (error) => {
    const message = error && error.message ? error.message : String(error);
    publish(
      "disconnected",
      /Waiting failed: \d+ms exceeded/.test(message)
        ? "WhatsApp took too long to show a QR code. Use a different WhatsApp to try again."
        : message,
    );
    try {
      await client.destroy();
    } catch {
      // The browser may already be closed.
    }
  });

  let lastPageText = "";
  const pageTimer = setInterval(async () => {
    if (!client.pupPage || state.status === "ready" || state.status === "qr") return;
    try {
      const info = await client.pupPage.evaluate(() => {
        const text = (document.body && document.body.innerText) || "";
        const button = [...document.querySelectorAll("button, div[role='button']")].find((node) =>
          /use here/i.test(node.innerText || ""),
        );
        if (button) button.click();
        return { clicked: Boolean(button), text: text.replace(/\s+/g, " ").trim().slice(0, 180) };
      });
      if (info.clicked) console.log(`[whatsapp ${label}] clicked Use here`);
      if (info.text && info.text !== lastPageText) {
        lastPageText = info.text;
        console.log(`[whatsapp ${label}] page: ${info.text}`);
      }
    } catch (error) {
      const message = `page check: ${error.message}`;
      if (message !== lastPageText) {
        lastPageText = message;
        console.log(`[whatsapp ${label}] ${message}`);
      }
    }
  }, 5000);
  client.on("ready", () => clearInterval(pageTimer));
  client.on("disconnected", () => clearInterval(pageTimer));

  return {
    getStatus() {
      return { ...state };
    },
    isReady() {
      return state.status === "ready";
    },
    createGroup(name, participantIds) {
      return client.createGroup(name, participantIds, { autoSendInviteV4: false });
    },
    async findGroup(name) {
      if (!client.pupPage) return "";
      const records = await client.pupPage.evaluate(() => {
        const rows = [];
        const chats = window.require("WAWebCollections").Chat.getModelsArray();
        for (const chat of chats) {
          const id = chat.id?._serialized || chat.id?.$1 || "";
          rows.push({
            id,
            isGroup: Boolean(chat.groupMetadata) || String(id).endsWith("@g.us"),
            name: chat.name || "",
            formattedTitle: chat.formattedTitle || "",
            subject: chat.groupMetadata?.subject || "",
          });
        }
        try {
          const metadata =
            window.require("WAWebCollections").GroupMetadata ||
            window.require("WAWebCollections").WAWebGroupMetadataCollection;
          for (const group of metadata?.getModelsArray?.() || []) {
            rows.push({
              id: group.id?._serialized || group.id?.$1 || "",
              isGroup: true,
              subject: group.subject || "",
            });
          }
        } catch {
          // The metadata collection name changes between WhatsApp versions.
        }
        return rows;
      });
      const groupId = groupIdFromChats(records, name);
      if (groupId) console.log(`[whatsapp ${label}] reusing group "${name}"`);
      return groupId;
    },
    addParticipants(groupId, participantIds) {
      return client.getChatById(groupId).then((chat) =>
        chat.addParticipants(participantIds, {
          autoSendInviteV4: false,
          sleep: [3000, 5000],
        }),
      );
    },
    async participantIds(groupId) {
      if (!client.pupPage) return [];
      return client.pupPage.evaluate(async (serialized) => {
        const wid = window.require("WAWebWidFactory").createWid(serialized);
        const collection = window.require("WAWebCollections").Chat;
        const chat = collection.get(wid) || (await collection.find(wid));
        const raw = chat?.groupMetadata?.participants;
        const list = raw?.serialize?.() || raw?._models || raw || [];
        const phones = [];
        for (const participant of list) {
          const id = participant.id || participant;
          let phone = id;
          if (id && id.server === "lid") {
            const resolved = window.require("WAWebApiContact").getPhoneNumber(id);
            phone = (await Promise.resolve(resolved)) || id;
          }
          const user = phone?.user || String(phone?._serialized || phone?.$1 || "").split("@")[0];
          if (user) phones.push(String(user));
        }
        return phones;
      }, groupId);
    },
    sendMessage(groupId, text) {
      return client.sendMessage(groupId, text);
    },
    async destroy() {
      clearInterval(pageTimer);
      try {
        await client.logout();
      } catch {
        // The login may already be gone.
      }
      try {
        await client.destroy();
      } catch {
        // The browser may already be closed.
      }
      const sessionDir = path.join(__dirname, "..", ".wwebjs_auth", `session-${sessionId}`);
      try {
        await fs.promises.rm(sessionDir, { recursive: true, force: true, maxRetries: 5 });
      } catch (error) {
        console.log(`[whatsapp ${label}] session cleanup: ${error.message}`);
      }
    },
  };
}

module.exports = { createWhatsApp, findBrowser, groupIdFromChats };
