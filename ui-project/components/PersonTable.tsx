'use client';

import {
  Table,
  TableHeader,
  Column,
  TableBody,
  Row,
  Cell,
} from 'react-aria-components';

export interface PersonTableProps {
  fields: string[];
  data: Record<string, string>[];
}

export function PersonTable({ fields, data }: PersonTableProps) {
  return (
    <Table aria-label="Person data table">
      <TableHeader>
        {fields.map((field) => (
          <Column key={field} isRowHeader={field === fields[0]}>
            {field.replaceAll('_', ' ')}
          </Column>
        ))}
      </TableHeader>
      <TableBody>
        {data.map((row, rowIndex) => (
          <Row key={rowIndex}>
            {fields.map((field) => (
              <Cell key={field}>{row[field] ?? ''}</Cell>
            ))}
          </Row>
        ))}
      </TableBody>
    </Table>
  );
}

export default PersonTable;
