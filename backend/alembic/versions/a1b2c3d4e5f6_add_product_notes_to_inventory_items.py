"""add_product_notes_to_inventory_items

Revision ID: a1b2c3d4e5f6
Revises: 33ba84dc2a2d
Create Date: 2026-01-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '33ba84dc2a2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add product_notes column to inventory_items for purchasing notes
    op.add_column('inventory_items', sa.Column('product_notes', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('inventory_items', 'product_notes')
