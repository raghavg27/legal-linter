import { Link, Text } from '@react-email/components';

export function EmailFooter({ unsubscribeUrl }: { unsubscribeUrl: string }) {
  return (
    <>
      <Text>Acme Inc., 100 Market Street, Suite 300, San Francisco, CA 94105</Text>
      <Link href={unsubscribeUrl}>Unsubscribe</Link>
    </>
  );
}
