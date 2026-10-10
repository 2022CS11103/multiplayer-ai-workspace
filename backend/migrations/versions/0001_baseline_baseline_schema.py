"""baseline schema

Revision ID: 0001_baseline
Revises: 
Create Date: 2026-10-09 18:56:39.924921
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0001_baseline'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('users',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)

    op.create_table('workspaces',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('task', sa.Text(), nullable=False),
    sa.Column('github_repo', sa.String(length=255), nullable=True),
    sa.Column('github_issue', sa.String(length=64), nullable=True),
    sa.Column('invite_code', sa.String(length=16), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('workspaces', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_workspaces_invite_code'), ['invite_code'], unique=True)

    op.create_table('agent_runs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('status', sa.Enum('queued', 'running', 'paused', 'needs_human_input', 'completed', 'cancelled', 'error', name='agentstatus', native_enum=False), nullable=False),
    sa.Column('plan', sa.JSON(), nullable=False),
    sa.Column('completed_steps', sa.JSON(), nullable=False),
    sa.Column('decisions', sa.JSON(), nullable=False),
    sa.Column('pending', sa.JSON(), nullable=False),
    sa.Column('current_activity', sa.String(length=255), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('control_state', sa.JSON(), nullable=True),
    sa.Column('lease_owner', sa.String(length=120), nullable=True),
    sa.Column('lease_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('agent_runs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_agent_runs_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('audit_logs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=True),
    sa.Column('event_type', sa.String(length=80), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_audit_logs_event_type'), ['event_type'], unique=False)
        batch_op.create_index(batch_op.f('ix_audit_logs_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('decisions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('added_by', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['added_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('decisions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_decisions_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('messages',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=True),
    sa.Column('role', sa.Enum('user', 'agent', 'system', name='messagerole', native_enum=False), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_messages_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('room_events',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('seq', sa.Integer(), nullable=False),
    sa.Column('actor_id', sa.Uuid(), nullable=True),
    sa.Column('actor_type', sa.String(length=16), nullable=False),
    sa.Column('event_type', sa.String(length=80), nullable=False),
    sa.Column('schema_version', sa.Integer(), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('workspace_id', 'seq', name='uq_room_events_workspace_seq')
    )
    with op.batch_alter_table('room_events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_room_events_event_type'), ['event_type'], unique=False)
        batch_op.create_index(batch_op.f('ix_room_events_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('session_findings',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('claim', sa.Text(), nullable=False),
    sa.Column('verified', sa.Boolean(), nullable=False),
    sa.Column('source_id', sa.String(length=80), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('session_findings', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_session_findings_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('session_tasks',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=240), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('owner', sa.String(length=80), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('session_tasks', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_session_tasks_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('workspace_files',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('path', sa.String(length=255), nullable=False),
    sa.Column('language', sa.String(length=40), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('ydoc_state', sa.LargeBinary(), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('modified_by', sa.String(length=80), nullable=True),
    sa.Column('last_activity', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('workspace_id', 'path')
    )
    with op.batch_alter_table('workspace_files', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_workspace_files_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('workspace_members',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('role', sa.Enum('owner', 'editor', 'viewer', 'member', name='memberrole', native_enum=False), nullable=False),
    sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('workspace_id', 'user_id')
    )
    op.create_table('approvals',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('run_id', sa.Uuid(), nullable=False),
    sa.Column('action_type', sa.String(length=80), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('status', sa.Enum('pending', 'approved', 'rejected', 'timed_out', name='approvalstatus', native_enum=False), nullable=False),
    sa.Column('decided_by', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['decided_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['run_id'], ['agent_runs.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('approvals', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_approvals_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('file_snapshots',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('run_id', sa.Uuid(), nullable=True),
    sa.Column('path', sa.String(length=255), nullable=False),
    sa.Column('step_id', sa.String(length=80), nullable=True),
    sa.Column('checkpoint_index', sa.Integer(), nullable=True),
    sa.Column('actor', sa.String(length=80), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('ydoc_state', sa.LargeBinary(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['run_id'], ['agent_runs.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('file_snapshots', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_file_snapshots_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('tool_calls',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('run_id', sa.Uuid(), nullable=False),
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('tool_name', sa.String(length=80), nullable=False),
    sa.Column('arguments', sa.JSON(), nullable=False),
    sa.Column('result', sa.JSON(), nullable=True),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.ForeignKeyConstraint(['run_id'], ['agent_runs.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('tool_calls', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tool_calls_run_id'), ['run_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_tool_calls_workspace_id'), ['workspace_id'], unique=False)

    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('tool_calls', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_tool_calls_workspace_id'))
        batch_op.drop_index(batch_op.f('ix_tool_calls_run_id'))

    op.drop_table('tool_calls')
    with op.batch_alter_table('file_snapshots', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_file_snapshots_workspace_id'))

    op.drop_table('file_snapshots')
    with op.batch_alter_table('approvals', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_approvals_workspace_id'))

    op.drop_table('approvals')
    op.drop_table('workspace_members')
    with op.batch_alter_table('workspace_files', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_workspace_files_workspace_id'))

    op.drop_table('workspace_files')
    with op.batch_alter_table('session_tasks', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_session_tasks_workspace_id'))

    op.drop_table('session_tasks')
    with op.batch_alter_table('session_findings', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_session_findings_workspace_id'))

    op.drop_table('session_findings')
    with op.batch_alter_table('room_events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_room_events_workspace_id'))
        batch_op.drop_index(batch_op.f('ix_room_events_event_type'))

    op.drop_table('room_events')
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_messages_workspace_id'))

    op.drop_table('messages')
    with op.batch_alter_table('decisions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_decisions_workspace_id'))

    op.drop_table('decisions')
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_audit_logs_workspace_id'))
        batch_op.drop_index(batch_op.f('ix_audit_logs_event_type'))

    op.drop_table('audit_logs')
    with op.batch_alter_table('agent_runs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_agent_runs_workspace_id'))

    op.drop_table('agent_runs')
    with op.batch_alter_table('workspaces', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_workspaces_invite_code'))

    op.drop_table('workspaces')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_email'))

    op.drop_table('users')
    # ### end Alembic commands ###
