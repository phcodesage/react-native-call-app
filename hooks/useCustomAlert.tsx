import React, { createContext, useContext, useState, ReactNode } from 'react';
import { CustomModal, ModalType, ModalAction } from '@/components/CustomModal';

interface AlertOptions {
  type?: ModalType;
  title: string;
  message: string;
  actions?: ModalAction[];
  showCloseButton?: boolean;
  backdropDismiss?: boolean;
  animationType?: 'slide' | 'fade' | 'scale';
}

interface AlertContextType {
  showAlert: (options: AlertOptions) => void;
  hideAlert: () => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const AlertProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [alertConfig, setAlertConfig] = useState<AlertOptions | null>(null);

  const showAlert = (options: AlertOptions) => {
    setAlertConfig(options);
  };

  const hideAlert = () => {
    setAlertConfig(null);
  };

  return (
    <AlertContext.Provider value={{ showAlert, hideAlert }}>
      {children}
      {alertConfig && (
        <CustomModal
          visible={true}
          type={alertConfig.type}
          title={alertConfig.title}
          message={alertConfig.message}
          actions={alertConfig.actions}
          onClose={hideAlert}
          showCloseButton={alertConfig.showCloseButton}
          backdropDismiss={alertConfig.backdropDismiss}
          animationType={alertConfig.animationType}
        />
      )}
    </AlertContext.Provider>
  );
};

export const useCustomAlert = () => {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useCustomAlert must be used within an AlertProvider');
  }
  return context;
};

// Convenience functions to replace Alert.alert
export const useAlert = () => {
  const { showAlert, hideAlert } = useCustomAlert();

  const alert = (title: string, message: string, actions?: ModalAction[], type: ModalType = 'info') => {
    showAlert({
      type,
      title,
      message,
      actions: actions || [{ text: 'OK', onPress: hideAlert }],
      showCloseButton: false,
      backdropDismiss: false,
    });
  };

  const confirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
    confirmText = 'Confirm',
    cancelText = 'Cancel'
  ) => {
    showAlert({
      type: 'confirm',
      title,
      message,
      actions: [
        {
          text: cancelText,
          onPress: onCancel || hideAlert,
          style: 'cancel',
        },
        {
          text: confirmText,
          onPress: () => {
            onConfirm();
            hideAlert();
          },
          style: 'default',
        },
      ],
      showCloseButton: false,
      backdropDismiss: false,
    });
  };

  const success = (title: string, message: string, onClose?: () => void) => {
    showAlert({
      type: 'success',
      title,
      message,
      actions: [{ text: 'OK', onPress: onClose || hideAlert }],
      showCloseButton: false,
      backdropDismiss: true,
    });
  };

  const error = (title: string, message: string, onClose?: () => void) => {
    showAlert({
      type: 'error',
      title,
      message,
      actions: [{ text: 'OK', onPress: onClose || hideAlert }],
      showCloseButton: false,
      backdropDismiss: true,
    });
  };

  const warning = (title: string, message: string, onClose?: () => void) => {
    showAlert({
      type: 'warning',
      title,
      message,
      actions: [{ text: 'OK', onPress: onClose || hideAlert }],
      showCloseButton: false,
      backdropDismiss: true,
    });
  };

  return {
    alert,
    confirm,
    success,
    error,
    warning,
    showAlert,
    hideAlert,
  };
};
