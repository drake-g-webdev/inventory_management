import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Input from './Input';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
  });

  it('renders label when provided', () => {
    render(<Input label="Email" id="email" />);
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('does not render label when not provided', () => {
    render(<Input id="test" />);
    expect(screen.queryByRole('label')).not.toBeInTheDocument();
  });

  it('displays error message', () => {
    render(<Input error="Required field" />);
    expect(screen.getByText('Required field')).toBeInTheDocument();
  });

  it('applies error styling to input', () => {
    render(<Input error="Error" placeholder="test" />);
    const input = screen.getByPlaceholderText('test');
    expect(input).toHaveClass('border-red-500');
  });

  it('passes through HTML attributes', () => {
    render(<Input type="email" disabled placeholder="test" />);
    const input = screen.getByPlaceholderText('test');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toBeDisabled();
  });

  it('applies disabled styling', () => {
    render(<Input disabled placeholder="test" />);
    const input = screen.getByPlaceholderText('test');
    expect(input).toBeDisabled();
  });
});
