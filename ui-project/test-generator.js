/**
 * Test Generator
 *
 * Generates a unit test that verifies a new field is rendered in the PersonTable component.
 * Used by the UI agentic loop's self-healing update to produce tests after adding a column.
 */

/**
 * Generates a unit test that verifies a new field is rendered in the PersonTable component.
 *
 * @param {string} fieldName - The field name to generate a test for
 * @returns {string} Test code (vitest + @testing-library/react) that asserts the field is rendered
 */
function generateFieldTest(fieldName) {
  if (!fieldName || typeof fieldName !== 'string') {
    throw new Error('fieldName must be a non-empty string');
  }

  return `
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PersonTable from '../components/PersonTable';

describe('PersonTable - ${fieldName} column', () => {
  it('renders a column header for ${fieldName}', () => {
    const fields = ['name', 'email', 'address', 'phone_number', '${fieldName}'];
    const data = [{ name: 'Test', email: 'test@example.com', address: '123 St', phone_number: '555-0000', ${fieldName}: 'test_value' }];
    
    render(<PersonTable fields={fields} data={data} />);
    
    expect(screen.getByText('${fieldName}')).toBeInTheDocument();
  });

  it('renders cell data for ${fieldName}', () => {
    const fields = ['name', '${fieldName}'];
    const data = [{ name: 'Test', ${fieldName}: 'test_value' }];
    
    render(<PersonTable fields={fields} data={data} />);
    
    expect(screen.getByText('test_value')).toBeInTheDocument();
  });
});
`;
}

module.exports = { generateFieldTest };
