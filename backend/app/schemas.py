from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


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


class ChatRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class RedirectRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=4000)


class ApprovalDecisionRequest(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    note: str | None = None
