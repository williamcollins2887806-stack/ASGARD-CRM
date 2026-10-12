-- V384 down: снять персональный доступ к общему табелю.

DELETE FROM settings WHERE key = 'timesheet_global_viewer_user_ids';
