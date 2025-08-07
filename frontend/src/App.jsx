import React, { useState, useEffect, useCallback } from "react";
import GaugeComponent from "react-gauge-component";

const MAX_MESSAGES = 50;

const StatusIndicator = ({ isConnected, ttnName }) => (
  <div className="flex items-center justify-center mb-6 p-4">
    <div
      className={`w-3 h-3 rounded-full mr-3 transition-colors duration-300 ${
        isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
      }`}
    />
    <span className="font-semibold text-gray-700">
      {isConnected ? `Connected to ${ttnName}` : "Disconnected"}
    </span>
  </div>
);

const DeviceHeaderLabel = ({ deviceName }) => (
  <div className="justify-center mb-6 p-4 bg-gray-50 rounded-lg shadow-sm">
    <span>{`${deviceName}`}</span>
  </div>
);

const SensorGauge = ({ value, title, unit, min, max, color, subArcs }) => (
  <div className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300">
    <h3 className="text-lg font-semibold mb-4 text-center text-gray-800">
      {title}
    </h3>
    <div className="flex justify-center">
      <GaugeComponent
        value={value || 0}
        type="semicircle"
        labels={{
          tickLabels: {
            type: "outer",
            defaultTickValueConfig: {
              formatTextValue: (value) => value + unit,
            },
          },
          valueLabel: {
            formatTextValue: (value) => value.toFixed(1) + unit,
            style: { fontSize: "2rem", fontWeight: "bold", fill: color },
          },
        }}
        arc={{
          width: 0.2,
          padding: 0.005,
          cornerRadius: 1,
          subArcs: subArcs,
        }}
        pointer={{
          color: "#345243",
          length: 0.8,
          width: 15,
        }}
        minValue={min}
        maxValue={max}
      />
    </div>
    <div className="text-center mt-2">
      <span className="text-2xl font-bold" style={{ color }}>
        {value ? value.toFixed(1) : "-.-"}
        {unit}
      </span>
    </div>
  </div>
);

const MessageHistory = ({ messages }) => (
  <div className="bg-white p-6 rounded-lg shadow-md">
    <h2 className="text-xl font-semibold mb-4 text-gray-800">
      *DEV* Message History
    </h2>
    <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-md">
      {messages.length === 0 ? (
        <div className="p-4 text-gray-500 text-center">
          No messages received yet
        </div>
      ) : (
        messages.map((msg, index) => (
          <div
            key={index}
            className="p-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div>
                <strong>Device:</strong> {msg.deviceId}
              </div>
              <div>
                <strong>Received:</strong> {msg.receivedAt}
              </div>
              <div className="md:col-span-2">
                <strong>Data:</strong>
                <span className="ml-2 font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                  T: {msg.payload.Temp?.toFixed(1)}°C, WT:{" "}
                  {msg.payload.WaterT1?.toFixed(1)}°C, WT2:{" "}
                  {msg.payload.WaterT2?.toFixed(1)}°C, H:{" "}
                  {msg.payload.Humidity?.toFixed(1)}%, P:{" "}
                  {msg.payload.Pressure?.toFixed(1)}hPa
                </span>
              </div>
              <div className="text-gray-500 text-xs md:col-span-2">
                Local time: {msg.timestamp} {msg.isHistorical && "(Historical)"}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);

// Function to transform TTN message to our format
const transformTTNMessage = (ttnMessage, isHistorical = false) => {
  return {
    timestamp: new Date().toLocaleString(),
    receivedAt: new Date(ttnMessage.received_at).toLocaleTimeString(),
    deviceId: ttnMessage.end_device_ids?.device_id || "unknown",
    payload: ttnMessage.uplink_message?.decoded_payload || {},
    data: ttnMessage,
    isHistorical: isHistorical,
  };
};

const useWebSocket = () => {
  const [ws, setWs] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [isLoadingHistorical, setIsLoadingHistorical] = useState(true);

  // Fetch the latest message from TTN Storage API
  const fetchLatestMessage = useCallback(async () => {
    try {
      console.log("Fetching latest message from server...");
      const response = await fetch("/api/latest-message");

      console.log("Response status:", response.status);
      console.log(
        "Response headers:",
        Object.fromEntries(response.headers.entries())
      );

      if (response.ok) {
        const latestMessage = await response.json();

        console.log("Raw latest message from server:", latestMessage);

        if (latestMessage) {
          console.log("Latest message fetched:", latestMessage);
          const transformedMessage = transformTTNMessage(latestMessage, true);
          console.log("Transformed message:", transformedMessage);

          setMessages([transformedMessage]);
        } else {
          console.log("No historical messages found");
        }
      } else {
        console.error("Failed to fetch latest message:", response.status);
        const errorText = await response.text();
        console.error("Error response body:", errorText);
      }
    } catch (error) {
      console.error("Error fetching latest message:", error);
    } finally {
      setIsLoadingHistorical(false);
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//localhost:3000`;

    console.log(
      `Attempting WebSocket connection (attempt ${
        connectionAttempts + 1
      }): ${wsUrl}`
    );

    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log("WebSocket connected successfully");
      setIsConnected(true);
      setConnectionAttempts(0);
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "connection") {
          setIsConnected(data.status === "connected");
          console.log("Connection status update:", data.status);
        }

        if (data.type === "message" && data.payload) {
          console.log("Received real-time sensor data:", data.payload);

          const newMessage = transformTTNMessage(data.payload, false);

          setMessages((prev) => {
            const updated = [newMessage, ...prev];
            return updated.slice(0, MAX_MESSAGES);
          });
        }
      } catch (e) {
        console.error("Error parsing WebSocket message:", e);
      }
    };

    websocket.onclose = (event) => {
      console.log("WebSocket disconnected:", event.code, event.reason);
      setIsConnected(false);
      setConnectionAttempts((prev) => prev + 1);

      // Exponential backoff for reconnection
      const delay = Math.min(1000 * Math.pow(2, connectionAttempts), 30000);
      console.log(`Reconnecting in ${delay / 1000} seconds...`);
      setTimeout(connectWebSocket, delay);
    };

    websocket.onerror = (error) => {
      console.error("WebSocket error:", error);
      setIsConnected(false);
    };

    setWs(websocket);
  }, [connectionAttempts]);

  useEffect(() => {
    // First fetch the latest message, then connect WebSocket
    fetchLatestMessage().then(() => {
      connectWebSocket();
    });

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  return { isConnected, messages, isLoadingHistorical };
};

// Main Dashboard Component
const SensorDashboard = () => {
  const { isConnected, messages, isLoadingHistorical } = useWebSocket();
  const [latestData, setLatestData] = useState(null);

  // Get latest sensor values
  useEffect(() => {
    if (messages.length > 0) {
      setLatestData(messages[0]);
    }
  }, [messages]);

  // Define gauge configurations
  const buoyTemperatureConfig = {
    min: 0,
    max: 50,
    color: "#3b82f6",
    subArcs: [
      { limit: 10, color: "#60a5fa", showTick: true },
      { limit: 25, color: "#3b82f6", showTick: true },
      { limit: 35, color: "#1d4ed8", showTick: true },
      { limit: 50, color: "#1e3a8a", showTick: true },
    ],
  };

  const humidityConfig = {
    min: 0,
    max: 100,
    color: "#10b981",
    subArcs: [
      { limit: 25, color: "#6ee7b7", showTick: true },
      { limit: 50, color: "#34d399", showTick: true },
      { limit: 75, color: "#10b981", showTick: true },
      { limit: 100, color: "#047857", showTick: true },
    ],
  };

  const pressureConfig = {
    min: 950,
    max: 1050,
    color: "#ef4444",
    subArcs: [
      { limit: 980, color: "#fca5a5", showTick: true },
      { limit: 1010, color: "#f87171", showTick: true },
      { limit: 1030, color: "#ef4444", showTick: true },
      { limit: 1050, color: "#dc2626", showTick: true },
    ],
  };

  const tdsConfig = {
    min: 0,
    max: 700,
    color: "#a855f7",
    subArcs: [
      { limit: 100, color: "#d8b4fe", showTick: true },
      { limit: 300, color: "#c084fc", showTick: true },
      { limit: 500, color: "#a855f7", showTick: true },
      { limit: 700, color: "#7e22ce", showTick: true },
    ],
  };

  const surfaceTempConfig = {
    min: 0,
    max: 50,
    color: "#3b82f6",
    subArcs: [
      { limit: 10, color: "#93c5fd", showTick: true },
      { limit: 25, color: "#60a5fa", showTick: true },
      { limit: 35, color: "#2563eb", showTick: true },
      { limit: 50, color: "#1e40af", showTick: true },
    ],
  };

  const temp15mConfig = {
    min: 0,
    max: 50,
    color: "#14b8a6",
    subArcs: [
      { limit: 10, color: "#5eead4", showTick: true },
      { limit: 25, color: "#2dd4bf", showTick: true },
      { limit: 35, color: "#14b8a6", showTick: true },
      { limit: 50, color: "#0f766e", showTick: true },
    ],
  };

  return (
    <div>
      <div className="min-h-screen bg-gradient-to-br from-green-50 flex flex-col to-indigo-100 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-2">
            <h2 className="text-2xl font-bold text-gray-800 mb-1">
              Port Philip Bay
            </h2>
            <h1 className="text-5xl font-bold text-gray-800 mb-3">
              Reef Monitoring Dashboard
            </h1>
            <p className="text-gray-600">
              Real-time environmental sensor data from TTN
            </p>
          </div>

          <StatusIndicator isConnected={isConnected} ttnName="Reef Device 01" />

          {isLoadingHistorical && (
            <div className="bg-white p-8 rounded-lg shadow-md text-center text-gray-500 mb-8">
              <div className="text-6xl mb-4">🔄</div>
              <p className="text-lg">Loading latest sensor data...</p>
            </div>
          )}

          {!isLoadingHistorical && !latestData && (
            <div className="bg-white p-8 rounded-lg shadow-md text-center text-gray-500 mb-8">
              <div className="text-6xl mb-4">📡</div>
              <p className="text-lg">Waiting for sensor data...</p>
              <p className="text-sm mt-2">
                Make sure your TTN device is sending data
              </p>
            </div>
          )}

          <DeviceHeaderLabel deviceName="Reef Buoy 1" />

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
            <SensorGauge
              value={latestData?.payload?.Temp ?? 0}
              title="Buoy Temperature"
              unit="°C"
              {...buoyTemperatureConfig}
            />
            <SensorGauge
              value={latestData?.payload?.WaterT1 ?? 0}
              title="Water Temperature Surface"
              unit="°C"
              {...surfaceTempConfig}
            />
            <SensorGauge
              value={latestData?.payload?.WaterT2 ?? 0}
              title="Water Temperature 1.5m deep"
              unit="°C"
              {...temp15mConfig}
            />
            <SensorGauge
              value={latestData?.payload?.Humidity ?? 0}
              title="Humidity"
              unit="%"
              {...humidityConfig}
            />
            <SensorGauge
              value={latestData?.payload?.Pressure ?? 0}
              title="Atmospheric Pressure"
              unit="hPa"
              {...pressureConfig}
            />
            <SensorGauge
              value={latestData?.payload?.TDS ?? 0}
              title="TDS"
              unit="ppm"
              {...tdsConfig}
            />
          </div>

          <DeviceHeaderLabel deviceName="Weather Station" />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
            <SensorGauge
              value={latestData?.payload?.Temp ?? 0}
              title="Temperature"
              unit="°C"
              {...buoyTemperatureConfig}
            />
            <SensorGauge
              value={latestData?.payload?.Humidity ?? 0}
              title="Humidity"
              unit="%"
              {...humidityConfig}
            />
            <SensorGauge
              value={latestData?.payload?.Pressure ?? 0}
              title="Atmospheric Pressure"
              unit="hPa"
              {...pressureConfig}
            />
          </div>

          <MessageHistory messages={messages} />
        </div>
      </div>
      <footer className="border border-t-8 border-blue-400 bottom-0 left-0 w-full p-3.5 text-center">
        <p className="text-sm">
          Port Philiip Bay - RMIT - Brighton Sea Scouts - 2025
        </p>
      </footer>
    </div>
  );
};

export default SensorDashboard;
