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

// Helper function to fetch latest message for a specific device
async function fetchLatestMessageForDevice(deviceId) {
  try {
    // Clean the application ID - remove @ttn suffix for API calls
    const cleanAppId = TTN_CONFIG.applicationId.replace("@ttn", "");
    const storageUrl = `https://${TTN_CONFIG.region}.cloud.thethings.network/api/v3/as/applications/${cleanAppId}/devices/${deviceId}/packages/storage/uplink_message`;

    console.log(
      `Fetching latest message for device ${deviceId} from: ${storageUrl}`
    );

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

    console.log(`TTN API Response status for ${deviceId}: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `TTN Storage API error for ${deviceId}: ${response.status} ${response.statusText}`
      );
      console.error(`Error response body:`, errorText);
      return null;
    }

    // Parse JSON response
    const data = await response.json();
    console.log(`TTN Storage API response received for ${deviceId}`);

    // TTN Storage API returns an object with a "result" property containing the message
    if (data.result) {
      console.log(`Found latest message in storage for ${deviceId}`);
      return data.result;
    } else {
      console.log(`No messages found in storage for ${deviceId}`);
      return null;
    }
  } catch (error) {
    console.error(
      `Error fetching latest message for device ${deviceId}:`,
      error
    );
    return null;
  }
}

// API endpoint to fetch the latest messages from both devices
app.get("/api/latest-messages", async (req, res) => {
  console.log("API endpoint /api/latest-messages hit!");

  try {
    const messages = [];

    // Fetch from buoy device if configured
    if (TTN_CONFIG.buoyDeviceID) {
      console.log(`Fetching from buoy device: ${TTN_CONFIG.buoyDeviceID}`);
      const buoyMessage = await fetchLatestMessageForDevice(
        TTN_CONFIG.buoyDeviceID
      );
      if (buoyMessage) {
        console.log(
          "Buoy message found:",
          buoyMessage.end_device_ids?.device_id
        );
        messages.push(buoyMessage);
      } else {
        console.log("No buoy message found");
      }
    }

    // Fetch from weather station device if configured
    if (TTN_CONFIG.weatherStationDeviceId) {
      console.log(
        `Fetching from weather station device: ${TTN_CONFIG.weatherStationDeviceId}`
      );
      const weatherMessage = await fetchLatestMessageForDevice(
        TTN_CONFIG.weatherStationDeviceId
      );
      if (weatherMessage) {
        console.log(
          "Weather station message found:",
          weatherMessage.end_device_ids?.device_id
        );
        messages.push(weatherMessage);
      } else {
        console.log("No weather station message found");
      }
    }

    // If no specific device IDs are configured, fall back to general application query
    if (!TTN_CONFIG.buoyDeviceID && !TTN_CONFIG.weatherStationDeviceId) {
      console.log(
        "No specific device IDs configured, fetching from application level"
      );

      const cleanAppId = TTN_CONFIG.applicationId.replace("@ttn", "");
      const storageUrl = `https://${TTN_CONFIG.region}.cloud.thethings.network/api/v3/as/applications/${cleanAppId}/packages/storage/uplink_message`;

      const url = new URL(storageUrl);
      url.searchParams.append("limit", "10"); // Get more messages to potentially find both devices
      url.searchParams.append("order", "-received_at");

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${TTN_CONFIG.apiKey}`,
          Accept: "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Application-level response:", data);

        if (data.result) {
          // Handle both single message and array of messages
          const allMessages = Array.isArray(data.result)
            ? data.result
            : [data.result];
          messages.push(...allMessages);
          console.log(
            `Found ${allMessages.length} messages from application query`
          );
        }
      } else {
        console.error("Application-level query failed:", response.status);
      }
    }

    console.log(`Returning ${messages.length} total messages`);
    res.json(messages);
  } catch (error) {
    console.error("Error fetching latest messages:", error);
    res.status(500).json({
      error: "Failed to fetch latest messages",
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

    // Subscribe to all devices in the application
    const topic = `v3/${TTN_CONFIG.applicationId}/devices/+/up`;

    // Subscribe to the topic
    mqttClient.subscribe(topic, (err) => {
      if (err) {
        console.error("Subscription error:", err);
        return;
      }

      console.log("Subscribed to:", topic);
      console.log("Listening for messages from all devices in application");
    });
  });

  mqttClient.on("message", (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      const deviceId = payload.end_device_ids?.device_id;

      console.log("Received message on topic:", topic);
      console.log("Device ID:", deviceId);

      // Log which device sent the message
      if (deviceId === TTN_CONFIG.buoyDeviceID) {
        console.log("Message from BUOY device");
      } else if (deviceId === TTN_CONFIG.weatherStationDeviceId) {
        console.log("Message from WEATHER STATION device");
      } else {
        console.log("Message from unknown/unconfigured device:", deviceId);
      }

      // Broadcast to all connected WebSocket clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: "message",
              topic: topic,
              payload: payload,
              deviceType:
                deviceId === TTN_CONFIG.buoyDeviceID
                  ? "buoy"
                  : deviceId === TTN_CONFIG.weatherStationDeviceId
                  ? "weather"
                  : "unknown",
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
  console.log("Device Configuration:");
  console.log(
    `- Buoy Device ID: ${TTN_CONFIG.buoyDeviceID || "Not configured"}`
  );
  console.log(
    `- Weather Station Device ID: ${
      TTN_CONFIG.weatherStationDeviceId || "Not configured"
    }`
  );
  console.log(`- Application ID: ${TTN_CONFIG.applicationId}`);
  console.log(`- Region: ${TTN_CONFIG.region}`);

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
