
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PersonTable from '../components/PersonTable';

describe('PersonTable - age column', () => {
  it('renders a column header for age', () => {
    const fields = ['name', 'email', 'address', 'phone_number', 'age'];
    const data = [{ name: 'Test', email: 'test@example.com', address: '123 St', phone_number: '555-0000', age: 'test_value' }];
    
    render(<PersonTable fields={fields} data={data} />);
    
    expect(screen.getByText('age')).toBeInTheDocument();
  });

  it('renders cell data for age', () => {
    const fields = ['name', 'age'];
    const data = [{ name: 'Test', age: 'test_value' }];
    
    render(<PersonTable fields={fields} data={data} />);
    
    expect(screen.getByText('test_value')).toBeInTheDocument();
  });
});
