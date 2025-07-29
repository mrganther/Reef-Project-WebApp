// server.js

require("dotenv").config();

const TTN_CONFIG = {
  region: process.env.TTN_REGION,
  applicationId: process.env.TTN_APP_ID,
  apiKey: process.env.TTN_API_KEY,
  deviceId: process.env.TTN_DEVICE_ID || "",
};

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mqtt = require("mqtt");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Function to establish MQTT connection
function connectToTTN() {
  const brokerUrl = `mqtts://${TTN_CONFIG.region}.cloud.thethings.network:8883/mqtt`;

  console.log(`Connecting to MQTT broker: ${brokerUrl}`);

  const mqttClient = mqtt.connect(brokerUrl, {
    username: TTN_CONFIG.applicationId,
    password: TTN_CONFIG.apiKey,
    clientId: "nodejs_server_" + Math.random().toString(16).substr(2, 8),
  });

  mqttClient.on("connect", () => {
    console.log("Connected to TTN MQTT broker");

    // Create topic based on deviceId if provided
    let topic = `v3/${TTN_CONFIG.applicationId}/devices/+/up`;
    if (TTN_CONFIG.deviceId) {
      topic = `v3/${TTN_CONFIG.applicationId}/devices/${TTN_CONFIG.deviceId}/up`;
    }

    // Subscribe to the topic
    mqttClient.subscribe(topic, (err) => {
      if (err) {
        console.error("Subscription error:", err);
        return;
      }

      console.log("Subscribed to:", topic);
    });
  });

  mqttClient.on("message", (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      console.log("Received message on topic:", topic);

      // Broadcast to all connected WebSocket clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: "message",
              topic: topic,
              payload: payload,
            })
          );
        }
      });
    } catch (e) {
      console.error("Error parsing MQTT message:", e);
    }
  });

  mqttClient.on("error", (err) => {
    console.error("MQTT error:", err);
  });

  mqttClient.on("close", () => {
    console.log(
      "MQTT connection closed, attempting to reconnect in 5 seconds..."
    );
    setTimeout(connectToTTN, 5000);
  });

  return mqttClient;
}

// Store global MQTT client reference
let globalMqttClient = null;

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Connect to TTN MQTT broker
  globalMqttClient = connectToTTN();
});

// Handle WebSocket connections
wss.on("connection", (ws) => {
  console.log("WebSocket client connected");

  // Send connection success message immediately
  ws.send(
    JSON.stringify({
      type: "connection",
      status: "connected",
    })
  );

  // Handle client disconnection
  ws.on("close", () => {
    console.log("WebSocket client disconnected");
  });
});
