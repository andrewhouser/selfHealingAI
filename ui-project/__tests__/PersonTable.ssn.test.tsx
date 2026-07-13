
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PersonTable from '../components/PersonTable';

describe('PersonTable - ssn column', () => {
  it('renders a column header for ssn', () => {
    const fields = ['name', 'email', 'address', 'phone_number', 'ssn'];
    const data = [{ name: 'Test', email: 'test@example.com', address: '123 St', phone_number: '555-0000', ssn: 'test_value' }];
    
    render(<PersonTable fields={fields} data={data} />);
    
    expect(screen.getByText('ssn')).toBeInTheDocument();
  });

  it('renders cell data for ssn', () => {
    const fields = ['name', 'ssn'];
    const data = [{ name: 'Test', ssn: 'test_value' }];
    
    render(<PersonTable fields={fields} data={data} />);
    
    expect(screen.getByText('test_value')).toBeInTheDocument();
  });
});
