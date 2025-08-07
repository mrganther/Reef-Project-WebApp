// server.js

require("dotenv").config();

const TTN_CONFIG = {
  region: process.env.TTN_REGION,
  applicationId: process.env.TTN_APP_ID,
  apiKey: process.env.TTN_API_KEY,
  deviceId: process.env.TTN_DEVICE_ID || "",
  weatherStationDeviceId: process.env.TTN_DEVICE_WS_ID,
  buoyDeviceID: process.env.TTN_DEVICE_BUOY_ID,
};

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mqtt = require("mqtt");
const path = require("path");
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Add middleware for parsing JSON
app.use(express.json());

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// API endpoint to fetch the latest message from TTN Storage
app.get("/api/latest-message", async (req, res) => {
  console.log("API endpoint /api/latest-message hit!");

  try {
    // Clean the application ID - remove @ttn suffix for API calls
    const cleanAppId = TTN_CONFIG.applicationId.replace("@ttn", "");
    const storageUrl = `https://${TTN_CONFIG.region}.cloud.thethings.network/api/v3/as/applications/${cleanAppId}/packages/storage/uplink_message`;

    console.log(`Fetching latest message from: ${storageUrl}`);

    // Create URL with proper query parameters for TTN Storage API
    const url = new URL(storageUrl);
    url.searchParams.append("limit", "1");
    url.searchParams.append("order", "-received_at");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TTN_CONFIG.apiKey}`,
        Accept: "application/json",
      },
    });

    console.log(`TTN API Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `TTN Storage API error: ${response.status} ${response.statusText}`
      );
      console.error(`Error response body:`, errorText);
      return res.status(500).json({
        error: `TTN API error: ${response.status} ${response.statusText}`,
        details: errorText,
      });
    }

    // Parse JSON response
    const data = await response.json();
    console.log("TTN Storage API response received");

    // TTN Storage API returns an object with a "result" property containing the message
    if (data.result) {
      console.log("Found latest message in storage");
      res.json(data.result);
    } else {
      console.log("No messages found in storage - this could mean:");
      console.log("1. Storage Integration is not enabled for this application");
      console.log("2. No messages have been stored yet");
      console.log("3. Messages have expired (check retention period)");
      res.json(null);
    }
  } catch (error) {
    console.error("Error fetching latest message:", error);
    res.status(500).json({
      error: "Failed to fetch latest message",
      details: error.message,
    });
  }
});

// Serve static files (after API routes)
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
