/**
 * Agent Connection
 *
 * Manages the WebSocket RPC connection between the Gateway and the
 * Clinical Agent Runtime. Adapted from OpenClaw's Gateway <-> Pi agent
 * communication protocol.
 *
 * In OpenClaw, the Pi agent connects to the Gateway via WebSocket and
 * receives messages in RPC mode. The Gateway sends patient messages to
 * the agent and receives responses back. This is the same pattern.
 */

import type { WebSocket } from "ws";
import type { Logger } from "pino";

interface AgentMessage {
  type: string;
  patientId: string;
  channel: string;
  from: string;
  body: string;
  timestamp: string;
}

interface AgentResponse {
  type: string;
  body: string;
  skillUsed?: string;
  flagForPhysician?: boolean;
  alertSeverity?: "info" | "warning" | "urgent" | "emergency";
}

export class AgentConnection {
  private ws: WebSocket;
  private logger: Logger;
  private pendingRequests: Map<
    string,
    { resolve: (value: AgentResponse) => void; reject: (err: Error) => void }
  >;
  private requestCounter: number;

  constructor(ws: WebSocket, logger: Logger) {
    this.ws = ws;
    this.logger = logger.child({ component: "agent-connection" });
    this.pendingRequests = new Map();
    this.requestCounter = 0;

    this.ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleAgentMessage(message);
      } catch (err) {
        this.logger.error({ err }, "Failed to parse agent message");
      }
    });
  }

  /**
   * Send a patient message to the agent runtime and await the response.
   * Uses a request/response pattern with correlation IDs (like RPC).
   */
  async sendMessage(message: AgentMessage): Promise<AgentResponse> {
    const requestId = `req_${++this.requestCounter}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Agent response timeout (30s)"));
      }, 30_000);

      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.ws.send(
        JSON.stringify({
          ...message,
          requestId,
        })
      );

      this.logger.info(
        { requestId, channel: message.channel },
        "Message sent to agent runtime"
      );
    });
  }

  /**
   * Handle response messages from the agent runtime.
   */
  private handleAgentMessage(message: { requestId?: string } & AgentResponse): void {
    if (message.requestId && this.pendingRequests.has(message.requestId)) {
      const pending = this.pendingRequests.get(message.requestId)!;
      this.pendingRequests.delete(message.requestId);
      pending.resolve(message);
    } else {
      // Unsolicited message from agent (e.g., proactive outreach)
      this.logger.info(
        { type: message.type },
        "Received unsolicited agent message"
      );
    }
  }

  /**
   * Check if the agent connection is alive.
   */
  isConnected(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }
}
