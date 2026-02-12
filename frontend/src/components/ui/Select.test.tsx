import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Select from './Select';

const testOptions = [
  { value: '1', label: 'Option A' },
  { value: '2', label: 'Option B' },
  { value: '3', label: 'Option C' },
];

describe('Select', () => {
  it('renders a select element', () => {
    render(<Select options={testOptions} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders default "Select..." option', () => {
    render(<Select options={testOptions} />);
    expect(screen.getByText('Select...')).toBeInTheDocument();
  });

  it('renders all provided options', () => {
    render(<Select options={testOptions} />);
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
    expect(screen.getByText('Option C')).toBeInTheDocument();
  });

  it('renders label when provided', () => {
    render(<Select label="Choose one" id="sel" options={testOptions} />);
    expect(screen.getByText('Choose one')).toBeInTheDocument();
  });

  it('displays error message', () => {
    render(<Select error="Selection required" options={testOptions} />);
    expect(screen.getByText('Selection required')).toBeInTheDocument();
  });

  it('applies disabled state', () => {
    render(<Select disabled options={testOptions} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
