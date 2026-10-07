import { Button, Html, Text } from '@react-email/components';

export default function ResetPassword({ url }: { url: string }) {
  return (
    <Html>
      <Text>Someone asked to reset your password. If it was you, use the button below.</Text>
      <Button href={url}>Reset password</Button>
    </Html>
  );
}
