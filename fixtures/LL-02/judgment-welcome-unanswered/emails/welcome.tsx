import { Heading, Html, Text } from '@react-email/components';

export default function Welcome({ name }: { name: string }) {
  return (
    <Html>
      <Heading>Welcome to Acme, {name}</Heading>
      <Text>Here are three ways teams get value from Acme in their first week, plus our current offers.</Text>
    </Html>
  );
}
