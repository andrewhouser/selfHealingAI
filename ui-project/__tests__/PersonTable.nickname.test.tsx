
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PersonTable from '../components/PersonTable';

describe('PersonTable - nickname column', () => {
  it('renders a column header for nickname', () => {
    const fields = ['name', 'email', 'address', 'phone_number', 'nickname'];
    const data = [{ name: 'Test', email: 'test@example.com', address: '123 St', phone_number: '555-0000', nickname: 'test_value' }];
    
    render(<PersonTable fields={fields} data={data} />);
    
    expect(screen.getByText('nickname')).toBeInTheDocument();
  });

  it('renders cell data for nickname', () => {
    const fields = ['name', 'nickname'];
    const data = [{ name: 'Test', nickname: 'test_value' }];
    
    render(<PersonTable fields={fields} data={data} />);
    
    expect(screen.getByText('test_value')).toBeInTheDocument();
  });
});
