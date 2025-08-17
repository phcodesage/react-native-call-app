import React from 'react';
import { CustomModal, ModalAction } from './CustomModal';

interface SessionExpiredModalProps {
  visible: boolean;
  onLogin: () => void;
  onClose?: () => void;
}

export const SessionExpiredModal: React.FC<SessionExpiredModalProps> = ({
  visible,
  onLogin,
  onClose,
}) => {
  const actions: ModalAction[] = [
    {
      text: 'Login Again',
      onPress: onLogin,
      style: 'default',
      icon: 'log-in',
    },
  ];

  return (
    <CustomModal
      visible={visible}
      type="warning"
      title="Session Expired"
      message="Your session has expired. Please log in again to continue using the app."
      actions={actions}
      onClose={onClose}
      showCloseButton={false}
      backdropDismiss={false}
      animationType="scale"
    />
  );
};
