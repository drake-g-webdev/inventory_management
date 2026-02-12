"""
Unit tests for model business logic.
Tests InventoryItem.is_low_stock() and suggested_order_qty() with order_at threshold.
Tests OrderStatus enum completeness.
"""
import math
from app.models.inventory import InventoryItem
from app.models.order import OrderStatus


# ============== is_low_stock() TESTS ==============

class TestInventoryItemIsLowStock:

    def test_low_stock_below_order_at(self):
        item = InventoryItem(current_stock=3, order_at=5, par_level=20)
        assert item.is_low_stock() is True

    def test_not_low_stock_above_order_at(self):
        item = InventoryItem(current_stock=10, order_at=5, par_level=20)
        assert item.is_low_stock() is False

    def test_low_stock_at_exact_order_at(self):
        item = InventoryItem(current_stock=5, order_at=5, par_level=20)
        assert item.is_low_stock() is True

    def test_fallback_to_par_level_when_order_at_null(self):
        item = InventoryItem(current_stock=15, order_at=None, par_level=20)
        assert item.is_low_stock() is True

    def test_not_low_stock_above_par_fallback(self):
        item = InventoryItem(current_stock=25, order_at=None, par_level=20)
        assert item.is_low_stock() is False

    def test_no_thresholds_set(self):
        item = InventoryItem(current_stock=5, order_at=None, par_level=None)
        assert item.is_low_stock() is False

    def test_zero_stock(self):
        item = InventoryItem(current_stock=0, order_at=5, par_level=20)
        assert item.is_low_stock() is True

    def test_none_stock_treated_as_zero(self):
        item = InventoryItem(current_stock=None, order_at=5, par_level=20)
        assert item.is_low_stock() is True


# ============== suggested_order_qty() TESTS ==============

class TestSuggestedOrderQty:

    def test_below_threshold_orders_to_par(self):
        item = InventoryItem(current_stock=3, order_at=5, par_level=20)
        assert item.suggested_order_qty() == 17  # 20 - 3

    def test_above_threshold_no_order(self):
        item = InventoryItem(current_stock=10, order_at=5, par_level=20)
        assert item.suggested_order_qty() == 0

    def test_with_avg_weekly_usage(self):
        item = InventoryItem(current_stock=3, order_at=5, par_level=20, avg_weekly_usage=5)
        assert item.suggested_order_qty() == 22  # 20 - 3 + 5

    def test_order_unit_conversion(self):
        item = InventoryItem(current_stock=3, order_at=5, par_level=20, units_per_order_unit=8)
        # needed = 17, 17/8 = 2.125, ceil = 3
        assert item.suggested_order_qty() == 3

    def test_no_par_level(self):
        item = InventoryItem(current_stock=3, order_at=5, par_level=None)
        assert item.suggested_order_qty() == 0

    def test_no_threshold_at_all(self):
        item = InventoryItem(current_stock=5, order_at=None, par_level=None)
        assert item.suggested_order_qty() == 0

    def test_fallback_threshold_to_par(self):
        item = InventoryItem(current_stock=15, order_at=None, par_level=20)
        assert item.suggested_order_qty() == 5  # 20 - 15

    def test_zero_stock_full_par(self):
        item = InventoryItem(current_stock=0, order_at=5, par_level=20)
        assert item.suggested_order_qty() == 20  # 20 - 0

    def test_rounds_up_to_whole_order_units(self):
        item = InventoryItem(current_stock=0, order_at=5, par_level=10, units_per_order_unit=3)
        # needed = 10, 10/3 = 3.33, ceil = 4
        assert item.suggested_order_qty() == 4

    def test_at_threshold_orders(self):
        item = InventoryItem(current_stock=5, order_at=5, par_level=20)
        assert item.suggested_order_qty() == 15  # 20 - 5


# ============== OrderStatus Enum TESTS ==============

class TestOrderStatusEnum:

    def test_all_statuses_exist(self):
        expected = [
            "DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED",
            "CHANGES_REQUESTED", "ORDERED", "PARTIALLY_RECEIVED",
            "RECEIVED", "CANCELLED"
        ]
        for name in expected:
            assert hasattr(OrderStatus, name), f"OrderStatus missing {name}"

    def test_status_values_match(self):
        assert OrderStatus.DRAFT.value == "draft"
        assert OrderStatus.SUBMITTED.value == "submitted"
        assert OrderStatus.UNDER_REVIEW.value == "under_review"
        assert OrderStatus.APPROVED.value == "approved"
        assert OrderStatus.CHANGES_REQUESTED.value == "changes_requested"
        assert OrderStatus.ORDERED.value == "ordered"
        assert OrderStatus.PARTIALLY_RECEIVED.value == "partially_received"
        assert OrderStatus.RECEIVED.value == "received"
        assert OrderStatus.CANCELLED.value == "cancelled"

    def test_enum_member_count(self):
        assert len(OrderStatus) == 9
