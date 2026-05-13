https://globalalumni-org.zoom.us/j/95565039134

you'd like to secure that context window because its content is what's dangerous to the LLM

compostability

MCP is not just adding1 function. its a complex API.

Agents are thes stripped down LLMs that we are trying to focus, and control with our prompts.

The more agents you have,the more problems you've got. Go with as few as you can.

The workbech, the workshop, and the factory.

AI is going to 

---

## Platform Work Summary

### Overview

Full-stack platform ownership across multiple production environments and client sites, with focus on reliability, real-time data integration, observability, and strategic adoption of AI-assisted development tools. Led infrastructure modernization, open-source contributions, and experimental AI/agentic workflows.

### RO IT Systems Platform (roitsystems-infra)
**Core Infrastructure:** Designed and maintain production Docker Compose stack (Caddy reverse proxy, CouchDB persistent store, NATS messaging, REST API, async worker processes). Serves as foundation for multiple services and integrations.

**Key Capabilities:**

- Multi-tenant architecture supporting different client deployments
- Real-time data ingestion pipeline (weather station, IoT sensor data)
- Message-driven async processing reducing operational bottlenecks
- Zero-downtime deployment capability through container orchestration
- Centralized logging and observability for multi-component system

**Reliability & Scale:** Manages platform serving continuous data feeds, API clients, and background processing with monitoring infrastructure to catch issues before client impact.

### morganeoger.ca Client Platform
Extended platform patterns to client-specific deployments, demonstrating ability to scale infrastructure decisions across different operational contexts. Tailored monitoring and deployment strategies for client requirements.

### Real-Time Data Integration (SignalK Plugins)

Authored open-source SignalK plugins for hardware integration:

- **HCALORY Heater Plugin:** BLE protocol reverse-engineering and implementation for marine heating system monitoring
- **Ecowitt GW2000B Plugin:** Weather station integration pipeline (polling, parsing, unit conversion, data transformation)

These contributions demonstrate:

- Initiative to solve concrete operational problems via open-source code
- Ability to decode hardware protocols and build reliable integrations
- Systems thinking (data ingestion → transformation → consumption)

### AI-Assisted Development & Agentic AI

**Copilot Pilots:** Evaluated GitHub Copilot effectiveness on platform codebase, assessing productivity gains and code quality implications for infrastructure work.

**Agentic AI Initiative (AgenticAI):** Active participant in exploring agent-based workflows using Claude API. Work includes:

- Designing agentic systems for complex, multi-step platform tasks
- Evaluating LLM capabilities for infrastructure automation and decision support
- Building agent frameworks that reduce manual context switching in platform operations
- Strategic assessment of where agentic patterns improve platform reliability vs. operational overhead

### Platform Leadership Themes

- **Ownership:** End-to-end responsibility from infrastructure design through client operations
- **Reliability:** Proactive monitoring, failure prevention, and graceful degradation patterns
- **Strategic Simplicity:** Choosing bounded solutions (Docker Compose vs. Kubernetes, NATS vs. distributed queues) that scale with team and problem size
- **Open Source Participation:** Contributing reusable solutions back to ecosystems used by platform
- **Future-Ready:** Early adoption of AI-assisted development and agentic workflows to stay ahead of operational complexity curve
