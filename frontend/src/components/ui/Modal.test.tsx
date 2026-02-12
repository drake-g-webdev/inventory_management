import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from './Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal isOpen={false} onClose={() => {}}>
        <p>Content</p>
      </Modal>
    );
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('renders children when open', () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <p>Visible content</p>
      </Modal>
    );
    expect(screen.getByText('Visible content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="My Title">
        <p>Body</p>
      </Modal>
    );
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('does not render title header when not provided', () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <p>Body</p>
      </Modal>
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Test">
        <p>Body</p>
      </Modal>
    );
    // Click the backdrop (the div with bg-black class)
    const backdrop = document.querySelector('.bg-black');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies size class', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} size="lg">
        <p>Body</p>
      </Modal>
    );
    const modal = document.querySelector('.max-w-lg');
    expect(modal).not.toBeNull();
  });
});
