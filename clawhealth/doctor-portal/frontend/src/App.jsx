import { useState, useEffect, useCallback } from "react";

const API = "";

function severity_color(severity) {
  return severity === "emergency" ? "#dc2626"
    : severity === "urgent" ? "#ea580c"
    : severity === "warning" ? "#ca8a04"
    : "#6b7280";
}

function StatusBadge({ status }) {
  const color = status === "running" ? "#16a34a" : status === "offline" ? "#dc2626" : "#9ca3af";
  return (
    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%",
      backgroundColor: color, marginRight: 8 }} />
  );
}

// --- Dashboard View ---
function Dashboard({ patients, onSelectPatient }) {
  const totalAlerts = patients.reduce((sum, p) => sum + (p.unackedAlerts || 0), 0);
  const online = patients.filter((p) => p.containerStatus === "running").length;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        <StatCard label="Active Patients" value={patients.length} />
        <StatCard label="Containers Online" value={`${online}/${patients.length}`} />
        <StatCard label="Unresolved Alerts" value={totalAlerts}
          color={totalAlerts > 0 ? "#dc2626" : "#16a34a"} />
      </div>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Patient List</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
            <th style={{ padding: "8px 12px" }}>Status</th>
            <th style={{ padding: "8px 12px" }}>Patient</th>
            <th style={{ padding: "8px 12px" }}>Phone</th>
            <th style={{ padding: "8px 12px" }}>Physician</th>
            <th style={{ padding: "8px 12px" }}>Alerts</th>
            <th style={{ padding: "8px 12px" }}></th>
          </tr>
        </thead>
        <tbody>
          {patients.map((p) => (
            <tr key={p.patientId} style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
              onClick={() => onSelectPatient(p.patientId)}>
              <td style={{ padding: "10px 12px" }}><StatusBadge status={p.containerStatus} /></td>
              <td style={{ padding: "10px 12px", fontWeight: 500 }}>{p.name}</td>
              <td style={{ padding: "10px 12px", color: "#6b7280" }}>{p.phone}</td>
              <td style={{ padding: "10px 12px", color: "#6b7280" }}>{p.physicianName}</td>
              <td style={{ padding: "10px 12px" }}>
                {p.unackedAlerts > 0 && (
                  <span style={{ backgroundColor: severity_color(p.worstAlert), color: "white",
                    padding: "2px 8px", borderRadius: 12, fontSize: 13 }}>
                    {p.unackedAlerts}
                  </span>
                )}
              </td>
              <td style={{ padding: "10px 12px", color: "#3b82f6" }}>View →</td>
            </tr>
          ))}
          {patients.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#9ca3af" }}>
              No patients registered yet. Use clawctl.sh to add patients.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: "white", borderRadius: 8, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || "#111827" }}>{value}</div>
    </div>
  );
}

// --- Patient Detail View ---
function PatientDetail({ patientId, onBack }) {
  const [tab, setTab] = useState("alerts");
  const [alerts, setAlerts] = useState([]);
  const [vitals, setVitals] = useState([]);
  const [meds, setMeds] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [adherence, setAdherence] = useState(null);
  const [summary, setSummary] = useState(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [aRes, vRes, mRes, cRes, adRes, sRes] = await Promise.all([
        fetch(`${API}/api/patients/${patientId}/alerts`),
        fetch(`${API}/api/patients/${patientId}/vitals?days=30`),
        fetch(`${API}/api/patients/${patientId}/medications`),
        fetch(`${API}/api/patients/${patientId}/conversations?limit=30`),
        fetch(`${API}/api/patients/${patientId}/adherence?days=30`),
        fetch(`${API}/api/patients/${patientId}`),
      ]);
      if (aRes.ok) setAlerts(await aRes.json());
      if (vRes.ok) setVitals(await vRes.json());
      if (mRes.ok) setMeds(await mRes.json());
      if (cRes.ok) setConversations(await cRes.json());
      if (adRes.ok) setAdherence(await adRes.json());
      if (sRes.ok) setSummary(await sRes.json());
    } catch (e) { console.error("Fetch error:", e); }
  }, [patientId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function sendMessage() {
    if (!message.trim()) return;
    setSending(true);
    try {
      await fetch(`${API}/api/patients/${patientId}/message`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      setMessage("");
      fetchAll();
    } catch (e) { console.error(e); }
    setSending(false);
  }

  async function ackAlert(alertId) {
    await fetch(`${API}/api/patients/${patientId}/alerts/${alertId}/acknowledge`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    fetchAll();
  }

  const patientName = summary?.patient
    ? `${summary.patient.firstName} ${summary.patient.lastName}`.trim() || patientId
    : patientId;

  const tabs = ["alerts", "vitals", "medications", "conversations"];

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "#3b82f6",
        cursor: "pointer", fontSize: 14, marginBottom: 16, padding: 0 }}>
        ← Back to Dashboard
      </button>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{patientName}</h2>

      {/* Quick stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard label="Active Conditions" value={summary?.conditions?.length || 0} />
        <StatCard label="Active Medications" value={meds.filter((m) => m.status === "active").length} />
        <StatCard label="30-Day Adherence"
          value={adherence?.adherenceRate != null ? `${adherence.adherenceRate}%` : "N/A"}
          color={adherence?.adherenceRate >= 80 ? "#16a34a" : adherence?.adherenceRate >= 50 ? "#ca8a04" : "#dc2626"} />
        <StatCard label="Open Alerts" value={alerts.filter((a) => !a.acknowledged).length}
          color={alerts.some((a) => !a.acknowledged) ? "#dc2626" : "#16a34a"} />
      </div>

      {/* Send message to patient */}
      <div style={{ background: "white", borderRadius: 8, padding: 16, marginBottom: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Send message through ClawBox:</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" value={message} onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type a message for the patient..."
            style={{ flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6 }} />
          <button onClick={sendMessage} disabled={sending || !message.trim()}
            style={{ padding: "8px 20px", backgroundColor: "#3b82f6", color: "white",
              border: "none", borderRadius: 6, cursor: "pointer", opacity: sending ? 0.5 : 1 }}>
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid #e5e7eb" }}>
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "8px 20px", background: "none", border: "none",
              borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
              color: tab === t ? "#3b82f6" : "#6b7280", cursor: "pointer",
              fontWeight: tab === t ? 600 : 400, textTransform: "capitalize" }}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "alerts" && (
        <div>
          {alerts.filter((a) => !a.acknowledged).length === 0 && (
            <p style={{ color: "#6b7280", padding: 16 }}>No unresolved alerts.</p>
          )}
          {alerts.map((a) => (
            <div key={a.id} style={{ background: a.acknowledged ? "#f9fafb" : "white",
              borderLeft: `4px solid ${severity_color(a.severity)}`, padding: "12px 16px",
              marginBottom: 8, borderRadius: 4, boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              opacity: a.acknowledged ? 0.6 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{a.title}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: severity_color(a.severity),
                    textTransform: "uppercase" }}>{a.severity}</span>
                </div>
                {!a.acknowledged && (
                  <button onClick={() => ackAlert(a.id)}
                    style={{ padding: "4px 12px", fontSize: 12, background: "#f3f4f6",
                      border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer" }}>
                    Acknowledge
                  </button>
                )}
              </div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{a.description}</div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>{a.created_at}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "vitals" && (
        <div>
          {vitals.length === 0 && <p style={{ color: "#6b7280", padding: 16 }}>No vitals recorded yet.</p>}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>Type</th>
                <th style={{ padding: "8px 12px" }}>Value</th>
                <th style={{ padding: "8px 12px" }}>Source</th>
                <th style={{ padding: "8px 12px" }}>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {vitals.map((v) => (
                <tr key={v.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 12px", textTransform: "capitalize" }}>
                    {(v.type || "").replace("_", " ")}
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 500 }}>
                    {v.value_text || v.value_numeric} {v.unit}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#6b7280" }}>{v.source}</td>
                  <td style={{ padding: "8px 12px", color: "#6b7280" }}>{v.recorded_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "medications" && (
        <div>
          {meds.length === 0 && <p style={{ color: "#6b7280", padding: 16 }}>No medications on file.</p>}
          {meds.map((m) => (
            <div key={m.id} style={{ background: "white", padding: "12px 16px", marginBottom: 8,
              borderRadius: 4, boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              borderLeft: m.status === "active" ? "4px solid #16a34a" : "4px solid #9ca3af" }}>
              <div style={{ fontWeight: 600 }}>{m.name}</div>
              <div style={{ fontSize: 13, color: "#6b7280" }}>
                {m.dose} — {m.frequency}
                {m.instructions && ` (${m.instructions})`}
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                {m.prescriber && `Prescribed by ${m.prescriber} · `}
                {m.pharmacy_name && `Pharmacy: ${m.pharmacy_name}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "conversations" && (
        <div style={{ maxHeight: 500, overflowY: "auto" }}>
          {conversations.length === 0 && <p style={{ color: "#6b7280", padding: 16 }}>No conversations yet.</p>}
          {conversations.map((c, i) => (
            <div key={i} style={{ display: "flex", justifyContent: c.direction === "inbound" ? "flex-start" : "flex-end",
              marginBottom: 8 }}>
              <div style={{ maxWidth: "70%", padding: "8px 14px", borderRadius: 12,
                backgroundColor: c.direction === "inbound" ? "#f3f4f6" : "#dbeafe",
                color: "#111827" }}>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>
                  {c.direction === "inbound" ? "Patient" : "ClawBox"} · {c.channel} · {c.created_at}
                </div>
                <div style={{ fontSize: 14 }}>{c.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main App ---
export default function App() {
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchDashboard() {
    try {
      const res = await fetch(`${API}/api/dashboard`);
      if (res.ok) {
        const data = await res.json();
        setPatients(data.patients || []);
      }
    } catch (e) { console.error("Dashboard fetch error:", e); }
    setLoading(false);
  }

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "white", borderBottom: "1px solid #e5e7eb", padding: "12px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>ClawHealth</span>
          <span style={{ fontSize: 13, color: "#6b7280" }}>Doctor Portal</span>
        </div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          {patients.filter((p) => p.containerStatus === "running").length} containers online
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
        {loading ? (
          <p style={{ textAlign: "center", color: "#6b7280", padding: 40 }}>Loading...</p>
        ) : selectedPatient ? (
          <PatientDetail patientId={selectedPatient} onBack={() => setSelectedPatient(null)} />
        ) : (
          <Dashboard patients={patients} onSelectPatient={setSelectedPatient} />
        )}
      </div>
    </div>
  );
}
