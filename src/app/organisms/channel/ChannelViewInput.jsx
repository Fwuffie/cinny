/* eslint-disable react/prop-types */
import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import './ChannelViewInput.scss';

import TextareaAutosize from 'react-autosize-textarea';

import initMatrix from '../../../client/initMatrix';
import cons from '../../../client/state/cons';
import settings from '../../../client/state/settings';
import { bytesToSize } from '../../../util/common';

import Text from '../../atoms/text/Text';
import RawIcon from '../../atoms/system-icons/RawIcon';
import IconButton from '../../atoms/button/IconButton';
import ContextMenu from '../../atoms/context-menu/ContextMenu';
import ScrollView from '../../atoms/scroll/ScrollView';
import EmojiBoard from '../emoji-board/EmojiBoard';

import CirclePlusIC from '../../../../public/res/ic/outlined/circle-plus.svg';
import EmojiIC from '../../../../public/res/ic/outlined/emoji.svg';
import SendIC from '../../../../public/res/ic/outlined/send.svg';
import ShieldIC from '../../../../public/res/ic/outlined/shield.svg';
import VLCIC from '../../../../public/res/ic/outlined/vlc.svg';
import VolumeFullIC from '../../../../public/res/ic/outlined/volume-full.svg';
import MarkdownIC from '../../../../public/res/ic/outlined/markdown.svg';
import FileIC from '../../../../public/res/ic/outlined/file.svg';

const CMD_REGEX = /(\/|>[#*@]|:)(\S*)$/;
let isTyping = false;
let isCmdActivated = false;
let cmdCursorPos = null;
function ChannelViewInput({
  roomId, roomTimeline, timelineScroll, viewEvent,
}) {
  const [attachment, setAttachment] = useState(null);
  const [isMarkdown, setIsMarkdown] = useState(settings.isMarkdown);

  const textAreaRef = useRef(null);
  const inputBaseRef = useRef(null);
  const uploadInputRef = useRef(null);
  const uploadProgressRef = useRef(null);
  const rightOptionsRef = useRef(null);

  const TYPING_TIMEOUT = 5000;
  const mx = initMatrix.matrixClient;
  const { roomsInput } = initMatrix;

  useEffect(() => {
    settings.on(cons.events.settings.MARKDOWN_TOGGLED, setIsMarkdown);
    return () => {
      settings.removeListener(cons.events.settings.MARKDOWN_TOGGLED, setIsMarkdown);
    };
  }, []);

  const sendIsTyping = (isT) => {
    mx.sendTyping(roomId, isT, isT ? TYPING_TIMEOUT : undefined);
    isTyping = isT;

    if (isT === true) {
      setTimeout(() => {
        if (isTyping) sendIsTyping(false);
      }, TYPING_TIMEOUT);
    }
  };

  function uploadingProgress(myRoomId, { loaded, total }) {
    if (myRoomId !== roomId) return;
    const progressPer = Math.round((loaded * 100) / total);
    uploadProgressRef.current.textContent = `Uploading: ${bytesToSize(loaded)}/${bytesToSize(total)} (${progressPer}%)`;
    inputBaseRef.current.style.backgroundImage = `linear-gradient(90deg, var(--bg-surface-hover) ${progressPer}%, var(--bg-surface-low) ${progressPer}%)`;
  }
  function clearAttachment(myRoomId) {
    if (roomId !== myRoomId) return;
    setAttachment(null);
    inputBaseRef.current.style.backgroundImage = 'unset';
    uploadInputRef.current.value = null;
  }

  function rightOptionsA11Y(A11Y) {
    const rightOptions = rightOptionsRef.current.children;
    for (let index = 0; index < rightOptions.length; index += 1) {
      rightOptions[index].disabled = !A11Y;
    }
  }

  function activateCmd(prefix) {
    isCmdActivated = true;
    inputBaseRef.current.style.boxShadow = '0 0 0 1px var(--bg-positive)';
    rightOptionsA11Y(false);
    viewEvent.emit('cmd_activate', prefix);
  }
  function deactivateCmd() {
    if (inputBaseRef.current !== null) {
      inputBaseRef.current.style.boxShadow = 'var(--bs-surface-border)';
      rightOptionsA11Y(true);
    }
    isCmdActivated = false;
    cmdCursorPos = null;
  }
  function errorCmd() {
    inputBaseRef.current.style.boxShadow = '0 0 0 1px var(--bg-danger)';
  }
  function setCursorPosition(pos) {
    setTimeout(() => {
      textAreaRef.current.focus();
      textAreaRef.current.setSelectionRange(pos, pos);
    }, 0);
  }
  function replaceCmdWith(msg, cursor, replacement) {
    if (msg === null) return null;
    const targetInput = msg.slice(0, cursor);
    const cmdParts = targetInput.match(CMD_REGEX);
    const leadingInput = msg.slice(0, cmdParts.index);
    if (replacement.length > 0) setCursorPosition(leadingInput.length + replacement.length);
    return leadingInput + replacement + msg.slice(cursor);
  }
  function firedCmd(cmdData) {
    const msg = textAreaRef.current.value;
    textAreaRef.current.value = replaceCmdWith(
      msg, cmdCursorPos, typeof cmdData?.replace !== 'undefined' ? cmdData.replace : '',
    );
    deactivateCmd();
  }

  useEffect(() => {
    roomsInput.on(cons.events.roomsInput.UPLOAD_PROGRESS_CHANGES, uploadingProgress);
    roomsInput.on(cons.events.roomsInput.ATTACHMENT_CANCELED, clearAttachment);
    roomsInput.on(cons.events.roomsInput.FILE_UPLOADED, clearAttachment);
    viewEvent.on('cmd_error', errorCmd);
    viewEvent.on('cmd_fired', firedCmd);
    if (textAreaRef?.current !== null) {
      isTyping = false;
      textAreaRef.current.focus();
      textAreaRef.current.value = roomsInput.getMessage(roomId);
      setAttachment(roomsInput.getAttachment(roomId));
    }
    return () => {
      roomsInput.removeListener(cons.events.roomsInput.UPLOAD_PROGRESS_CHANGES, uploadingProgress);
      roomsInput.removeListener(cons.events.roomsInput.ATTACHMENT_CANCELED, clearAttachment);
      roomsInput.removeListener(cons.events.roomsInput.FILE_UPLOADED, clearAttachment);
      viewEvent.removeListener('cmd_error', errorCmd);
      viewEvent.removeListener('cmd_fired', firedCmd);
      if (isCmdActivated) deactivateCmd();
      if (textAreaRef?.current === null) return;

      const msg = textAreaRef.current.value;
      inputBaseRef.current.style.backgroundImage = 'unset';
      if (msg.trim() === '') {
        roomsInput.setMessage(roomId, '');
        return;
      }
      roomsInput.setMessage(roomId, msg);
    };
  }, [roomId]);

  async function sendMessage() {
    if (isCmdActivated) {
      viewEvent.emit('cmd_exe');
      return;
    }

    const msgBody = textAreaRef.current.value;
    if (roomsInput.isSending(roomId)) return;
    if (msgBody.trim() === '' && attachment === null) return;
    sendIsTyping(false);

    roomsInput.setMessage(roomId, msgBody);
    if (attachment !== null) {
      roomsInput.setAttachment(roomId, attachment);
    }
    textAreaRef.current.disabled = true;
    textAreaRef.current.style.cursor = 'not-allowed';
    await roomsInput.sendInput(roomId);
    textAreaRef.current.disabled = false;
    textAreaRef.current.style.cursor = 'unset';
    textAreaRef.current.focus();

    textAreaRef.current.value = roomsInput.getMessage(roomId);
    timelineScroll.reachBottom();
    viewEvent.emit('message_sent');
    textAreaRef.current.style.height = 'unset';
  }

  function processTyping(msg) {
    const isEmptyMsg = msg === '';

    if (isEmptyMsg && isTyping) {
      sendIsTyping(false);
      return;
    }
    if (!isEmptyMsg && !isTyping) {
      sendIsTyping(true);
    }
  }

  function getCursorPosition() {
    return textAreaRef.current.selectionStart;
  }

  function recognizeCmd(rawInput) {
    const cursor = getCursorPosition();
    const targetInput = rawInput.slice(0, cursor);

    const cmdParts = targetInput.match(CMD_REGEX);
    if (cmdParts === null) {
      if (isCmdActivated) {
        deactivateCmd();
        viewEvent.emit('cmd_deactivate');
      }
      return;
    }
    const cmdPrefix = cmdParts[1];
    const cmdSlug = cmdParts[2];

    if (cmdPrefix === ':') {
      // skip emoji autofill command if link is suspected.
      const checkForLink = targetInput.slice(0, cmdParts.index);
      if (checkForLink.match(/(http|https|mailto|matrix|ircs|irc)$/)) {
        deactivateCmd();
        viewEvent.emit('cmd_deactivate');
        return;
      }
    }

    cmdCursorPos = cursor;
    if (cmdSlug === '') {
      activateCmd(cmdPrefix);
      return;
    }
    if (!isCmdActivated) activateCmd(cmdPrefix);
    inputBaseRef.current.style.boxShadow = '0 0 0 1px var(--bg-caution)';
    viewEvent.emit('cmd_process', cmdPrefix, cmdSlug);
  }

  function handleMsgTyping(e) {
    const msg = e.target.value;
    recognizeCmd(e.target.value);
    if (!isCmdActivated) processTyping(msg);
  }

  function handleKeyDown(e) {
    if (e.keyCode === 13 && e.shiftKey === false) {
      e.preventDefault();
      sendMessage();
    }
  }

  function addEmoji(emoji) {
    textAreaRef.current.value += emoji.unicode;
  }

  function handleUploadClick() {
    if (attachment === null) uploadInputRef.current.click();
    else {
      roomsInput.cancelAttachment(roomId);
    }
  }
  function uploadFileChange(e) {
    const file = e.target.files.item(0);
    setAttachment(file);
    if (file !== null) roomsInput.setAttachment(roomId, file);
  }

  function renderInputs() {
    return (
      <>
        <div className={`channel-input__option-container${attachment === null ? '' : ' channel-attachment__option'}`}>
          <input onChange={uploadFileChange} style={{ display: 'none' }} ref={uploadInputRef} type="file" />
          <IconButton onClick={handleUploadClick} tooltip={attachment === null ? 'Upload' : 'Cancel'} src={CirclePlusIC} />
        </div>
        <div ref={inputBaseRef} className="channel-input__input-container">
          {roomTimeline.isEncryptedRoom() && <RawIcon size="extra-small" src={ShieldIC} />}
          <ScrollView autoHide>
            <Text className="channel-input__textarea-wrapper">
              <TextareaAutosize
                ref={textAreaRef}
                onChange={handleMsgTyping}
                onResize={() => timelineScroll.autoReachBottom()}
                onKeyDown={handleKeyDown}
                placeholder="Send a message..."
              />
            </Text>
          </ScrollView>
          {isMarkdown && <RawIcon size="extra-small" src={MarkdownIC} />}
        </div>
        <div ref={rightOptionsRef} className="channel-input__option-container">
          <ContextMenu
            placement="top"
            content={(
              <EmojiBoard onSelect={addEmoji} />
            )}
            render={(toggleMenu) => <IconButton onClick={toggleMenu} tooltip="Emoji" src={EmojiIC} />}
          />
          <IconButton onClick={sendMessage} tooltip="Send" src={SendIC} />
        </div>
      </>
    );
  }

  function attachFile() {
    const fileType = attachment.type.slice(0, attachment.type.indexOf('/'));
    return (
      <div className="channel-attachment">
        <div className={`channel-attachment__preview${fileType !== 'image' ? ' channel-attachment__icon' : ''}`}>
          {fileType === 'image' && <img alt={attachment.name} src={URL.createObjectURL(attachment)} />}
          {fileType === 'video' && <RawIcon src={VLCIC} />}
          {fileType === 'audio' && <RawIcon src={VolumeFullIC} />}
          {fileType !== 'image' && fileType !== 'video' && fileType !== 'audio' && <RawIcon src={FileIC} />}
        </div>
        <div className="channel-attachment__info">
          <Text variant="b1">{attachment.name}</Text>
          <Text variant="b3"><span ref={uploadProgressRef}>{`size: ${bytesToSize(attachment.size)}`}</span></Text>
        </div>
      </div>
    );
  }

  return (
    <>
      { attachment !== null && attachFile() }
      <form className="channel-input" onSubmit={(e) => { e.preventDefault(); }}>
        {
          roomTimeline.room.isSpaceRoom()
            ? <Text className="channel-input__space" variant="b1">Spaces are yet to be implemented</Text>
            : renderInputs()
        }
      </form>
    </>
  );
}
ChannelViewInput.propTypes = {
  roomId: PropTypes.string.isRequired,
  roomTimeline: PropTypes.shape({}).isRequired,
  timelineScroll: PropTypes.shape({
    reachBottom: PropTypes.func,
    autoReachBottom: PropTypes.func,
    tryRestoringScroll: PropTypes.func,
    enableSmoothScroll: PropTypes.func,
    disableSmoothScroll: PropTypes.func,
  }).isRequired,
  viewEvent: PropTypes.shape({}).isRequired,
};

export default ChannelViewInput;