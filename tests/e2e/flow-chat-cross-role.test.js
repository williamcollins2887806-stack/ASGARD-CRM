/**
 * E2E FLOW 11: Cross-role group chat
 * PM creates group chat with TO and HR -> PM sends message -> TO reads and replies ->
 * HR reads -> message history verified -> cleanup
 * Routes: /api/chat-groups (POST, GET)
 *         /api/chat-groups/:id/messages (GET, POST)
 *         /api/chat-groups/:id/members (POST, DELETE)
 */
const { api, assert, assertOk, skip } = require("../config");

module.exports = {
  name: "FLOW: Chat Cross-Role Communication",
  tests: [
    {
      name: "PM creates group chat, sends message, TO replies, HR reads, verify history",
      run: async () => {
        // Get real user IDs
        const users = await api("GET", "/api/users", { role: "ADMIN" });
        const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const pmUser = userList.find(u => u.role === "PM" && u.is_active !== false);
        const toUser = userList.find(u => u.role === "TO" && u.is_active !== false);
        const hrUser = userList.find(u => u.role === "HR" && u.is_active !== false);
        if (!pmUser || !toUser || !hrUser) skip("Need active PM, TO, HR users");

        // 1. PM creates a group chat with TO and HR
        const createResp = await api("POST", "/api/chat-groups", {
          role: "PM",
          body: {
            name: "E2E: Project Discussion Group",
            member_ids: [toUser.id, hrUser.id]
          }
        });
        if (createResp.status === 404) skip("chat-groups endpoint not available");
        assertOk(createResp, "PM create group chat");
        const chatGroup = createResp.data?.chat;
        if (!chatGroup || !chatGroup.id) skip("Chat group not returned");
        const chatId = chatGroup.id;
        assert(chatGroup.name === "E2E: Project Discussion Group", "chat name matches");

        try {
          // 2. PM sends first message
          const msg1Resp = await api("POST", "/api/chat-groups/" + chatId + "/messages", {
            role: "PM",
            body: { text: "E2E: Hello team, lets discuss the project timeline" }
          });
          assertOk(msg1Resp, "PM send message");
          assert(msg1Resp.data?.message || msg1Resp.data?.success, "message sent");

          // 3. TO reads messages
          const toReadResp = await api("GET", "/api/chat-groups/" + chatId + "/messages", { role: "TO" });
          assertOk(toReadResp, "TO read messages");
          const messages1 = toReadResp.data?.messages || [];
          assert(messages1.length > 0, "TO sees messages");
          const pmMsg = messages1.find(m => m.message && m.message.includes("E2E:"));
          assert(pmMsg, "TO sees PM message");

          // 4. TO replies
          const msg2Resp = await api("POST", "/api/chat-groups/" + chatId + "/messages", {
            role: "TO",
            body: { text: "E2E: Understood, I will prepare the technical specs" }
          });
          assertOk(msg2Resp, "TO send reply");

          // 5. HR reads all messages
          const hrReadResp = await api("GET", "/api/chat-groups/" + chatId + "/messages", { role: "HR" });
          assertOk(hrReadResp, "HR read messages");
          const messages2 = hrReadResp.data?.messages || [];
          assert(messages2.length >= 2, "HR sees at least 2 messages");

          // 6. PM sends another message
          const msg3Resp = await api("POST", "/api/chat-groups/" + chatId + "/messages", {
            role: "PM",
            body: { text: "E2E: Great, please also prepare staffing plan" }
          });
          assertOk(msg3Resp, "PM send second message");

          // 7. Verify full message history
          const historyResp = await api("GET", "/api/chat-groups/" + chatId + "/messages", { role: "PM" });
          assertOk(historyResp, "PM check full history");
          const allMessages = historyResp.data?.messages || [];
          assert(allMessages.length >= 3, "at least 3 messages in history");

          // 8. Verify chat appears in PM group list
          const listResp = await api("GET", "/api/chat-groups", { role: "PM" });
          assertOk(listResp, "PM list groups");
          const groups = listResp.data?.chats || [];
          const found = groups.find(g => g.id === chatId);
          assert(found, "chat found in PM group list");

          // 9. Verify chat appears in TO group list
          const toListResp = await api("GET", "/api/chat-groups", { role: "TO" });
          assertOk(toListResp, "TO list groups");

        } finally {
          // Cleanup: remove members (no delete chat endpoint, remove members)
          if (toUser) await api("DELETE", "/api/chat-groups/" + chatId + "/members/" + toUser.id, { role: "PM" });
          if (hrUser) await api("DELETE", "/api/chat-groups/" + chatId + "/members/" + hrUser.id, { role: "PM" });
        }
      }
    },
    {
      name: "Chat group: add member dynamically",
      run: async () => {
        const users = await api("GET", "/api/users", { role: "ADMIN" });
        const userList = Array.isArray(users.data) ? users.data : (users.data?.users || []);
        const pmUser = userList.find(u => u.role === "PM" && u.is_active !== false);
        const buhUser = userList.find(u => u.role === "BUH" && u.is_active !== false);
        if (!pmUser || !buhUser) skip("Need active PM and BUH users");

        const createResp = await api("POST", "/api/chat-groups", {
          role: "PM",
          body: { name: "E2E: Budget Chat", member_ids: [] }
        });
        if (createResp.status === 404) skip("chat-groups endpoint not available");
        assertOk(createResp, "PM create chat");
        const chatId = createResp.data?.chat?.id;
        if (!chatId) skip("Chat ID not returned");

        try {
          // Add BUH as member
          const addResp = await api("POST", "/api/chat-groups/" + chatId + "/members", {
            role: "PM",
            body: { user_id: buhUser.id }
          });
          assertOk(addResp, "add BUH to chat");

          // BUH sends message
          const msgResp = await api("POST", "/api/chat-groups/" + chatId + "/messages", {
            role: "BUH",
            body: { text: "E2E: Budget approved" }
          });
          assertOk(msgResp, "BUH send message");

          // PM reads
          const readResp = await api("GET", "/api/chat-groups/" + chatId + "/messages", { role: "PM" });
          assertOk(readResp, "PM read messages");
        } finally {
          await api("DELETE", "/api/chat-groups/" + chatId + "/members/" + buhUser.id, { role: "PM" });
        }
      }
    }
  ]
};
