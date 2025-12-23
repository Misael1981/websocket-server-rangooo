// websocket-server.js
require("dotenv").config();
const WebSocket = require("ws");

const PORT = process.env.PORT || 3001;
const WS_SECRET = process.env.WS_SECRET;

if (!WS_SECRET) {
  console.error("❌ WS_SECRET não definido no ambiente");
  process.exit(1);
}

const wss = new WebSocket.Server({ port: PORT });
console.log(`🚀 WebSocket Server rodando na porta ${PORT}`);

/**
 * activeAgents
 * key: restaurantId
 * value: { ws, connectedAt }
 */
const activeAgents = new Map();

/**
 * connection handler
 */
wss.on("connection", (ws, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    const restaurantId = url.searchParams.get("restaurantId");
    const role = url.searchParams.get("role"); // "agent" | "saas"

    console.log(
      `🔗 Nova conexão: role=${role} restaurantId=${restaurantId} from=${req.socket.remoteAddress}`
    );

    // 🔐 Autenticação mínima
    if (!token || token !== WS_SECRET) {
      ws.close(1008, "Unauthorized");
      return;
    }

    if (!restaurantId || !role) {
      ws.close(1008, "Missing params");
      return;
    }

    ws.restaurantId = restaurantId;
    ws.role = role;

    // 🎉 AGENTE LOCAL
    if (role === "agent") {
      activeAgents.set(restaurantId, {
        ws,
        connectedAt: new Date(),
      });

      console.log(`🖨️ Agente conectado para restaurant ${restaurantId}`);

      ws.send(
        JSON.stringify({
          type: "agent_connected",
          restaurantId,
        })
      );
    }

    // 🚀 SAAS
    if (role === "saas") {
      ws.send(
        JSON.stringify({
          type: "welcome",
          server: "print-ws",
        })
      );
    }

    /**
     * message handler
     */
    ws.on("message", async (raw) => {
      try {
        const message = JSON.parse(raw.toString());

        // 📥 Pedido vindo do SaaS
        if (message.type === "print_order" && ws.role === "saas") {
          const sent = await sendToAgent(ws.restaurantId, message.order);

          ws.send(
            JSON.stringify({
              type: sent ? "print_ack" : "print_error",
              printId: message.order?.printId,
              success: sent,
            })
          );
        }

        // ❤️ Heartbeat
        if (message.type === "pong") {
          return;
        }
      } catch (err) {
        console.error("💥 Erro ao processar mensagem:", err);
      }
    });

    /**
     * heartbeat
     */
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    ws.on("close", () => {
      clearInterval(heartbeat);

      if (ws.role === "agent") {
        activeAgents.delete(ws.restaurantId);
        console.log(`🔌 Agente desconectado: ${ws.restaurantId}`);
      }
    });
  } catch (err) {
    console.error("💥 Erro na conexão:", err);
  }
});

/**
 * Envia pedido para o agente local
 */
async function sendToAgent(restaurantId, order) {
  const agent = activeAgents.get(restaurantId);

  if (!agent) {
    console.log(`❌ Nenhum agente online para ${restaurantId}`);
    return false;
  }

  if (agent.ws.readyState !== WebSocket.OPEN) {
    console.log(`❌ WebSocket do agente não está OPEN`);
    return false;
  }

  try {
    agent.ws.send(
      JSON.stringify({
        type: "print_order",
        order,
      })
    );

    console.log(
      `📤 Pedido ${order.printId} enviado para agente ${restaurantId}`
    );

    return true;
  } catch (err) {
    console.error("💥 Erro ao enviar para agente:", err);
    return false;
  }
}
