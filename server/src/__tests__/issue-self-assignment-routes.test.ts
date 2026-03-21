import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_AGENT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_AGENT_ID = "33333333-3333-4333-8333-333333333333";
const ISSUE_ID = "44444444-4444-4444-8444-444444444444";
const RUN_ID = "55555555-5555-4555-8555-555555555555";

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  documentService: () => ({}),
  executionWorkspaceService: () => ({}),
  goalService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectService: () => ({}),
  workProductService: () => ({}),
}));

function createAgentApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId: ACTOR_AGENT_ID,
      companyId: COMPANY_ID,
      runId: RUN_ID,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue self-assignment permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.canUser.mockResolvedValue(false);
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockAgentService.getById.mockResolvedValue({
      id: ACTOR_AGENT_ID,
      companyId: COMPANY_ID,
      role: "researcher",
      permissions: null,
    });
    mockHeartbeatService.wakeup.mockResolvedValue(undefined);
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("allows an agent to create a self-assigned issue without tasks:assign", async () => {
    mockIssueService.create.mockResolvedValue({
      id: ISSUE_ID,
      companyId: COMPANY_ID,
      identifier: "NOV-101",
      title: "Self assigned follow-up",
      status: "todo",
      assigneeAgentId: ACTOR_AGENT_ID,
      assigneeUserId: null,
    });

    const res = await request(createAgentApp())
      .post(`/api/companies/${COMPANY_ID}/issues`)
      .send({
        title: "Self assigned follow-up",
        status: "todo",
        assigneeAgentId: ACTOR_AGENT_ID,
        assigneeUserId: null,
      });

    expect(res.status).toBe(201);
    expect(mockAccessService.hasPermission).not.toHaveBeenCalled();
    expect(mockIssueService.create).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({
        title: "Self assigned follow-up",
        assigneeAgentId: ACTOR_AGENT_ID,
        createdByAgentId: ACTOR_AGENT_ID,
      }),
    );
  });

  it("allows an agent to self-assign its own unassigned issue without tasks:assign", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: ISSUE_ID,
      companyId: COMPANY_ID,
      identifier: "NOV-102",
      title: "Agent-created follow-up",
      status: "todo",
      createdByAgentId: ACTOR_AGENT_ID,
      createdByUserId: null,
      assigneeAgentId: null,
      assigneeUserId: null,
    });
    mockIssueService.update.mockResolvedValue({
      id: ISSUE_ID,
      companyId: COMPANY_ID,
      identifier: "NOV-102",
      title: "Agent-created follow-up",
      status: "todo",
      assigneeAgentId: ACTOR_AGENT_ID,
      assigneeUserId: null,
    });

    const res = await request(createAgentApp())
      .patch(`/api/issues/${ISSUE_ID}`)
      .send({
        assigneeAgentId: ACTOR_AGENT_ID,
        assigneeUserId: null,
      });

    expect(res.status).toBe(200);
    expect(mockAccessService.hasPermission).not.toHaveBeenCalled();
    expect(mockIssueService.update).toHaveBeenCalledWith(
      ISSUE_ID,
      expect.objectContaining({
        assigneeAgentId: ACTOR_AGENT_ID,
        assigneeUserId: null,
      }),
    );
  });

  it("still blocks an agent from self-assigning someone else's unassigned issue", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: ISSUE_ID,
      companyId: COMPANY_ID,
      identifier: "NOV-103",
      title: "Someone else's follow-up",
      status: "todo",
      createdByAgentId: OTHER_AGENT_ID,
      createdByUserId: null,
      assigneeAgentId: null,
      assigneeUserId: null,
    });

    const res = await request(createAgentApp())
      .patch(`/api/issues/${ISSUE_ID}`)
      .send({
        assigneeAgentId: ACTOR_AGENT_ID,
        assigneeUserId: null,
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Missing permission: tasks:assign" });
    expect(mockAccessService.hasPermission).toHaveBeenCalledWith(COMPANY_ID, "agent", ACTOR_AGENT_ID, "tasks:assign");
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });
});
