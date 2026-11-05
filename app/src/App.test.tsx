import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('rendert zonder fouten', () => {
    render(<App />);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});