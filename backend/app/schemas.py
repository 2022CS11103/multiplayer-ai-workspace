from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, model_validator


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: UUID
    name: str
    email: str

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    token: str
    user: UserOut


class CreateWorkspaceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    task: str = Field(min_length=1)
    github_repo: str | None = None
    github_issue: str | None = None


class JoinWorkspaceRequest(BaseModel):
    invite_code: str


class MemberOut(BaseModel):
    user_id: UUID
    name: str
    email: str
    role: str


class MessageOut(BaseModel):
    id: UUID
    user_id: UUID | None
    role: str
    content: str
    created_at: datetime
    author_name: str | None = None


class ToolCallOut(BaseModel):
    id: UUID
    tool_name: str
    arguments: dict
    result: dict | list | str | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ApprovalOut(BaseModel):
    id: UUID
    action_type: str
    payload: dict
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AgentRunOut(BaseModel):
    id: UUID
    status: str
    plan: list
    completed_steps: list
    decisions: list
    pending: list
    current_activity: str
    error: str | None
    created_at: datetime
    updated_at: datetime
    control_state: dict | None = None

    model_config = {"from_attributes": True}


class AuditOut(BaseModel):
    id: UUID
    user_id: UUID | None
    event_type: str
    payload: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceSummary(BaseModel):
    id: UUID
    name: str
    task: str
    invite_code: str
    github_repo: str | None
    github_issue: str | None
    created_at: datetime
    member_count: int
    invite_url: str | None = None


class DecisionOut(BaseModel):
    id: UUID
    text: str
    added_by: UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class TaskOut(BaseModel):
    id: UUID
    title: str
    status: str
    owner: str
    created_at: datetime

    model_config = {"from_attributes": True}


class DecisionCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class FindingOut(BaseModel):
    id: UUID
    claim: str
    verified: bool = False
    source_id: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class FindingCreate(BaseModel):
    claim: str = Field(min_length=1, max_length=4000)
    verified: bool = False
    source_id: str | None = None


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)


class TaskPatch(BaseModel):
    status: str = Field(pattern="^(open|doing|done)$")
    owner: str | None = None


class FileOut(BaseModel):
    path: str
    language: str
    content: str
    status: str
    modified_by: str | None = None
    last_activity: datetime | None = None


class FileIn(BaseModel):
    path: str = Field(min_length=1, max_length=255)
    language: str = "text"
    content: str = ""
    status: str = "unchanged"
    modified_by: str | None = None


class FilesPut(BaseModel):
    files: list[FileIn]


class CrdtUpdateRequest(BaseModel):
    path: str = Field(min_length=1, max_length=255)
    update_b64: str = Field(min_length=1, max_length=400_000)


class CrdtStateOut(BaseModel):
    path: str
    content: str
    actor: str | None = None
    state_b64: str = ""
    sv_b64: str = ""


class FileSnapshotOut(BaseModel):
    id: UUID
    path: str
    step_id: str | None = None
    checkpoint_index: int | None = None
    actor: str
    content: str
    state_b64: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AgentChatRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    author_id: str = "a-coding"


class EventCreate(BaseModel):
    event_type: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_]+$")
    text: str = Field(min_length=1, max_length=2000)


class MemberRolePatch(BaseModel):
    role: str = Field(pattern="^(owner|editor|viewer)$")


class PresenceUserOut(BaseModel):
    id: str
    name: str
    email: str
    role: str | None = None
    viewing: str | None = None


class HandoffRequest(BaseModel):
    to_user_id: UUID | None = None
    to_agent: str | None = Field(default=None, pattern="^(planner|coding|testing|human)$")
    summary: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def require_target(self):
        if self.to_user_id is None and not self.to_agent:
            raise ValueError("to_user_id or to_agent is required")
        return self


class WorkspaceDetail(BaseModel):
    id: UUID
    name: str
    task: str
    invite_code: str
    github_repo: str | None
    github_issue: str | None
    created_at: datetime
    members: list[MemberOut]
    messages: list[MessageOut]
    agent_run: AgentRunOut | None
    tool_calls: list[ToolCallOut]
    approvals: list[ApprovalOut]
    activity: list[AuditOut]
    decisions: list[DecisionOut] = []
    findings: list[FindingOut] = []
    tasks: list[TaskOut] = []
    files: list[FileOut] = []
    invite_url: str | None = None
    last_seq: int = 0


class ChatRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class RedirectRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=4000)
    plan: list[str] | None = None


class ApprovalDecisionRequest(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    note: str | None = None


class DraftCheckRequest(BaseModel):
    """Python statements run as a pytest test against the pending draft, e.g. `assert two_sum([3, 3], 6) == [0, 1]`."""

    code: str = Field(min_length=1, max_length=4000)
