/*
 * Copyright 2023 Nordeck IT + Consulting GmbH
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { getEnvironment } from '@matrix-widget-toolkit/mui';
import { BehaviorSubject, firstValueFrom, Subject, take, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, Mocked, vi } from 'vitest';
import { mockPeerConnectionStatistics } from '../lib/testUtils/documentTestUtils';
import {
  CommunicationChannel,
  CommunicationChannelStatistics,
  Message,
} from './communication';
import { PresentationManagerImpl } from './presentationManagerImpl';
import { WhiteboardInstance } from './types';

vi.mock('@matrix-widget-toolkit/mui', async () => ({
  ...(await vi.importActual<typeof import('@matrix-widget-toolkit/mui')>(
    '@matrix-widget-toolkit/mui',
  )),
  getEnvironment: vi.fn(),
}));

describe('presentationManager', () => {
  let communicationStatistics: CommunicationChannelStatistics;
  let observeCommunicationStatisticsSubject: Subject<CommunicationChannelStatistics>;
  let observeActiveSlideIdSubject: BehaviorSubject<string | undefined>;
  let observeActiveFrameElementIdSubject: BehaviorSubject<string | undefined>;
  let communicationChannel: Mocked<CommunicationChannel>;
  let messageSubject: Subject<Message>;
  let whiteboardInstance: Mocked<WhiteboardInstance>;
  let enableObserveVisibilityStateSubject: Subject<boolean>;
  let presentationManager: PresentationManagerImpl;

  beforeEach(async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) => {
      switch (name) {
        case 'REACT_APP_RTC':
          return 'webrtc';
        case 'REACT_APP_INFINITE_CANVAS':
          return 'false';
        default:
          return defaultValue;
      }
    });

    communicationStatistics = {
      localSession: {
        sessionId: 'own',
      },
      peerConnections: {
        'peer-0': mockPeerConnectionStatistics(
          '@user-bob:example.com',
          'connected',
          'session-0',
        ),
        'peer-1': mockPeerConnectionStatistics(
          '@user-charlie:example.com',
          'failed',
          'session-1',
        ),
      },
      sessions: {},
    };
    observeCommunicationStatisticsSubject =
      new Subject<CommunicationChannelStatistics>();
    messageSubject = new Subject<Message>();
    observeActiveSlideIdSubject = new BehaviorSubject<string | undefined>(
      'slide-0',
    );
    observeActiveFrameElementIdSubject = new BehaviorSubject<
      string | undefined
    >(undefined);

    communicationChannel = {
      broadcastMessage: vi.fn(),
      observeMessages: vi.fn().mockReturnValue(messageSubject),
      getStatistics: vi.fn().mockImplementation(() => communicationStatistics),
      observeStatistics: vi
        .fn()
        .mockReturnValue(observeCommunicationStatisticsSubject),
      destroy: vi.fn(),
    };

    whiteboardInstance = {
      addSlide: vi.fn(),
      clearUndoManager: vi.fn(),
      duplicateSlide: vi.fn(),
      export: vi.fn(),
      focusOn: vi.fn(),
      getActiveSlideId: vi
        .fn()
        .mockImplementation(() => observeActiveSlideIdSubject.value),
      getActiveSlide: vi.fn(),
      getActiveFrameElementId: vi
        .fn()
        .mockImplementation(() => observeActiveFrameElementIdSubject.value),
      getPresentationManager: vi.fn(),
      getPresentationSettings: vi.fn(),
      observePresentationSettings: vi.fn(),
      setPresentationTransition: vi.fn(),
      setPresentationSpeed: vi.fn(),
      setFrameTransition: vi.fn(),
      clearFrameTransitions: vi.fn(),
      getSlide: vi.fn(),
      getSlideIds: vi.fn(),
      getWhiteboardId: vi.fn(),
      getWhiteboardStatistics: vi.fn(),
      import: vi.fn(),
      isLoading: vi.fn(),
      getMismatchedSnapshotDetails: vi.fn(),
      observeMismatchedSnapshotDetails: vi.fn(),
      moveSlide: vi.fn(),
      observeActiveSlideId: vi
        .fn()
        .mockReturnValue(observeActiveSlideIdSubject),
      observeActiveFrameElementId: vi
        .fn()
        .mockReturnValue(observeActiveFrameElementIdSubject),
      observeIsLoading: vi.fn(),
      observeSlideIds: vi.fn(),
      observeUndoRedoState: vi.fn(),
      observeWhiteboardStatistics: vi.fn(),
      redo: vi.fn(),
      removeSlide: vi.fn(),
      setActiveSlideId: vi.fn(),
      setActiveFrameElementId: vi
        .fn()
        .mockImplementation((activeFrameElementId) =>
          observeActiveFrameElementIdSubject.next(activeFrameElementId),
        ),
      undo: vi.fn(),
      mergeMismatchedSnapshot: vi.fn(),
      destroy: vi.fn(),
      persist: vi.fn(),
    };

    enableObserveVisibilityStateSubject = new Subject<boolean>();
    presentationManager = new PresentationManagerImpl(
      whiteboardInstance,
      communicationChannel,
      enableObserveVisibilityStateSubject,
    );
  });

  it('should start the presentation', async () => {
    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    presentationManager.startPresentation();

    expect(await states).toEqual([
      { type: 'idle' },
      { type: 'presenting', isEditMode: false },
    ]);
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: false, slideId: 'slide-0' } },
      {
        reliable: true,
      },
    );
    expect(whiteboardInstance.setActiveSlideId).not.toHaveBeenCalled();
  });

  it('should start the presentation for active frame in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    presentationManager.startPresentation('frame-0');

    expect(await states).toEqual([
      { type: 'idle' },
      { type: 'presenting', isEditMode: false },
    ]);
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-0',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
    expect(whiteboardInstance.setActiveSlideId).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveFrameElementId).toHaveBeenCalledWith(
      'frame-0',
    );
  });

  it('should start the presentation for active frame in infinite canvas mode in matrix rtc mode', async () => {
    communicationStatistics = {
      localSession: {
        sessionId: 'own',
      },
      peerConnections: {},
      sessions: {},
    };

    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) => {
      switch (name) {
        case 'REACT_APP_INFINITE_CANVAS':
          return 'true';
        case 'REACT_APP_RTC':
          return 'matrixrtc';
        default:
          return defaultValue;
      }
    });

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    presentationManager.startPresentation('frame-0');

    expect(await states).toEqual([
      { type: 'idle' },
      { type: 'presenting', isEditMode: false },
    ]);
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-0',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
    expect(whiteboardInstance.setActiveSlideId).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveFrameElementId).toHaveBeenCalledWith(
      'frame-0',
    );
  });

  it('should stop the presentation', async () => {
    presentationManager.startPresentation();

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    presentationManager.stopPresentation();

    expect(await states).toEqual([
      { type: 'presenting', isEditMode: false },
      { type: 'idle' },
    ]);
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
      'net.nordeck.whiteboard.present_slide',
      { view: undefined },
      {
        reliable: true,
      },
    );
    expect(whiteboardInstance.setActiveSlideId).not.toHaveBeenCalled();
  });

  it('should stop the presentation for active frame in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    presentationManager.startPresentation('frame-0');

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    presentationManager.stopPresentation();

    expect(await states).toEqual([
      { type: 'presenting', isEditMode: false },
      { type: 'idle' },
    ]);
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
      'net.nordeck.whiteboard.present_frame',
      { view: undefined },
      {
        reliable: true,
      },
    );
    expect(whiteboardInstance.setActiveFrameElementId).toHaveBeenCalledWith(
      undefined,
    );
  });

  it('should stop the presentation for active frame in infinite canvas mode in matrix rtc mode', async () => {
    communicationStatistics = {
      localSession: {
        sessionId: 'own',
      },
      peerConnections: {},
      sessions: {},
    };

    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) => {
      switch (name) {
        case 'REACT_APP_INFINITE_CANVAS':
          return 'true';
        case 'REACT_APP_RTC':
          return 'matrixrtc';
        default:
          return defaultValue;
      }
    });

    presentationManager.startPresentation('frame-0');

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    presentationManager.stopPresentation();

    expect(await states).toEqual([
      { type: 'presenting', isEditMode: false },
      { type: 'idle' },
    ]);
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
      'net.nordeck.whiteboard.present_frame',
      { view: undefined },
      {
        reliable: true,
      },
    );
    expect(whiteboardInstance.setActiveFrameElementId).toHaveBeenCalledWith(
      undefined,
    );
  });

  it('should accept presentation start of a different user', async () => {
    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_slide',
      content: {
        view: { isEditMode: false, slideId: 'slide-0' },
      },
    });

    expect(await states).toEqual([
      { type: 'idle' },
      {
        type: 'presentation',
        presenterUserId: '@user-bob:example.com',
        isEditMode: false,
      },
    ]);
    expect(whiteboardInstance.clearUndoManager).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveSlideId).toHaveBeenCalledWith('slide-0');
  });

  it('should accept presentation start of a different user in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) => {
      switch (name) {
        case 'REACT_APP_INFINITE_CANVAS':
          return 'true';
        case 'REACT_APP_RTC':
          return 'webrtc';
        default:
          return defaultValue;
      }
    });

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_frame',
      content: {
        view: { isEditMode: false, frameId: 'frame-0' },
      },
    });

    expect(await states).toEqual([
      { type: 'idle' },
      {
        type: 'presentation',
        presenterUserId: '@user-bob:example.com',
        isEditMode: false,
      },
    ]);
    expect(whiteboardInstance.clearUndoManager).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveSlideId).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveFrameElementId).toHaveBeenCalledWith(
      'frame-0',
    );
  });

  it('should accept presentation start of a different user in infinite canvas mode in matrix rtc mode', async () => {
    communicationStatistics = {
      localSession: {
        sessionId: 'own',
      },
      peerConnections: {},
      sessions: {
        'session-bob': {
          userId: '@user-bob:example.com',
        },
      },
    };

    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) => {
      switch (name) {
        case 'REACT_APP_INFINITE_CANVAS':
          return 'true';
        case 'REACT_APP_RTC':
          return 'matrixrtc';
        default:
          return defaultValue;
      }
    });

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-bob',
      type: 'net.nordeck.whiteboard.present_frame',
      content: {
        view: { isEditMode: false, frameId: 'frame-0' },
      },
    });

    expect(await states).toEqual([
      { type: 'idle' },
      {
        type: 'presentation',
        presenterUserId: '@user-bob:example.com',
        isEditMode: false,
      },
    ]);
    expect(whiteboardInstance.clearUndoManager).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveSlideId).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveFrameElementId).toHaveBeenCalledWith(
      'frame-0',
    );
  });

  it('should accept presentation stop of a different user', async () => {
    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_slide',
      content: {
        view: { isEditMode: false, slideId: 'slide-0' },
      },
    });

    whiteboardInstance.setActiveSlideId.mockReset();

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_slide',
      content: { view: undefined },
    });

    expect(await states).toEqual([
      {
        type: 'presentation',
        presenterUserId: '@user-bob:example.com',
        isEditMode: false,
      },
      { type: 'idle' },
    ]);
    expect(whiteboardInstance.clearUndoManager).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveSlideId).not.toHaveBeenCalled();
  });

  it('should accept presentation stop of a different user in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) => {
      switch (name) {
        case 'REACT_APP_INFINITE_CANVAS':
          return 'true';
        case 'REACT_APP_RTC':
          return 'webrtc';
        default:
          return defaultValue;
      }
    });

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_frame',
      content: {
        view: { isEditMode: false, frameId: 'frame-0' },
      },
    });

    whiteboardInstance.setActiveSlideId.mockReset();
    whiteboardInstance.setActiveFrameElementId.mockReset();

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_frame',
      content: { view: undefined },
    });

    expect(await states).toEqual([
      {
        type: 'presentation',
        presenterUserId: '@user-bob:example.com',
        isEditMode: false,
      },
      { type: 'idle' },
    ]);
    expect(whiteboardInstance.clearUndoManager).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveSlideId).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveFrameElementId).toHaveBeenCalledWith(
      undefined,
    );
  });

  it('should accept presentation stop of a different user in infinite canvas mode in matrix rtc mode', async () => {
    communicationStatistics = {
      localSession: {
        sessionId: 'own',
      },
      peerConnections: {},
      sessions: {
        'session-bob': {
          userId: '@user-bob:example.com',
        },
      },
    };

    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) => {
      switch (name) {
        case 'REACT_APP_INFINITE_CANVAS':
          return 'true';
        case 'REACT_APP_RTC':
          return 'matrixrtc';
        default:
          return defaultValue;
      }
    });

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-bob',
      type: 'net.nordeck.whiteboard.present_frame',
      content: {
        view: { isEditMode: false, frameId: 'frame-0' },
      },
    });

    whiteboardInstance.setActiveSlideId.mockReset();
    whiteboardInstance.setActiveFrameElementId.mockReset();

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-bob',
      type: 'net.nordeck.whiteboard.present_frame',
      content: { view: undefined },
    });

    expect(await states).toEqual([
      {
        type: 'presentation',
        presenterUserId: '@user-bob:example.com',
        isEditMode: false,
      },
      { type: 'idle' },
    ]);
    expect(whiteboardInstance.clearUndoManager).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveSlideId).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveFrameElementId).toHaveBeenCalledWith(
      undefined,
    );
  });

  it('should accept the edit mode from a different user', async () => {
    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(3), toArray()),
    );

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_slide',
      content: {
        view: { isEditMode: true, slideId: 'slide-0' },
      },
    });

    expect(await states).toEqual([
      { type: 'idle' },
      {
        type: 'presentation',
        presenterUserId: '@user-bob:example.com',
        isEditMode: false,
      },
      {
        type: 'presentation',
        presenterUserId: '@user-bob:example.com',
        isEditMode: true,
      },
    ]);
    expect(whiteboardInstance.clearUndoManager).toHaveBeenCalled();
    expect(whiteboardInstance.setActiveSlideId).toHaveBeenCalledWith('slide-0');
  });

  it('should accept the edit mode from a different user in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) => {
      switch (name) {
        case 'REACT_APP_INFINITE_CANVAS':
          return 'true';
        case 'REACT_APP_RTC':
          return 'webrtc';
        default:
          return defaultValue;
      }
    });

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(3), toArray()),
    );

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_frame',
      content: {
        view: { isEditMode: true, frameId: 'frame-0' },
      },
    });

    expect(await states).toEqual([
      { type: 'idle' },
      {
        type: 'presentation',
        presenterUserId: '@user-bob:example.com',
        isEditMode: false,
      },
      {
        type: 'presentation',
        presenterUserId: '@user-bob:example.com',
        isEditMode: true,
      },
    ]);
    expect(whiteboardInstance.clearUndoManager).toHaveBeenCalled();
    expect(whiteboardInstance.setActiveSlideId).not.toHaveBeenCalled();
    expect(whiteboardInstance.setActiveFrameElementId).toHaveBeenCalledWith(
      'frame-0',
    );
  });

  it('should update the presentation state when a presenting user becomes disconnected', async () => {
    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_slide',
      content: {
        view: { isEditMode: false, slideId: 'slide-0' },
      },
    });

    whiteboardInstance.setActiveSlideId.mockReset();

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(2), toArray()),
    );

    communicationStatistics = {
      localSession: {
        sessionId: 'own',
      },
      peerConnections: {
        'peer-0': mockPeerConnectionStatistics(
          '@user-bob:example.com',
          'failed',
          'session-0',
        ),
      },
      sessions: {},
    };
    observeCommunicationStatisticsSubject.next(communicationStatistics);

    expect(await states).toEqual([
      {
        type: 'presentation',
        presenterUserId: '@user-bob:example.com',
        isEditMode: false,
      },
      { type: 'idle' },
    ]);
    expect(whiteboardInstance.setActiveSlideId).not.toHaveBeenCalled();
  });

  it('should broadcast the active slide when it changes', async () => {
    presentationManager.startPresentation();
    observeActiveSlideIdSubject.next('slide-1');
    observeActiveSlideIdSubject.next('slide-2');

    expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(3);

    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      1,
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: false, slideId: 'slide-0' } },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      2,
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: false, slideId: 'slide-1' } },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      3,
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: false, slideId: 'slide-2' } },
      {
        reliable: true,
      },
    );
  });

  it('should broadcast the active frame when it changes in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    presentationManager.startPresentation('frame-0');
    observeActiveFrameElementIdSubject.next('frame-1');
    observeActiveFrameElementIdSubject.next('frame-2');

    expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(3);

    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      1,
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-0',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      2,
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-1',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      3,
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-2',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
  });

  it('should broadcast the active slide when a new session is connected', async () => {
    presentationManager.startPresentation();

    communicationStatistics = {
      localSession: {
        sessionId: 'own',
      },
      peerConnections: {
        'peer-0': mockPeerConnectionStatistics(
          '@user-bob:example.com',
          'connected',
          'session-0',
        ),
        'peer-1': mockPeerConnectionStatistics(
          '@user-charlie:example.com',
          'failed',
          'session-1',
        ),
        'peer-2': mockPeerConnectionStatistics(
          '@user-dave:example.com',
          'connected',
          'session-3',
        ),
      },
      sessions: {},
    };
    observeCommunicationStatisticsSubject.next(communicationStatistics);

    expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(2);

    expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: false, slideId: 'slide-0' } },
      {
        reliable: true,
      },
    );
  });

  it('should broadcast the active frame when a new session is connected in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    presentationManager.startPresentation('frame-0');

    communicationStatistics = {
      localSession: {
        sessionId: 'own',
      },
      peerConnections: {
        'peer-0': mockPeerConnectionStatistics(
          '@user-bob:example.com',
          'connected',
          'session-0',
        ),
        'peer-1': mockPeerConnectionStatistics(
          '@user-charlie:example.com',
          'failed',
          'session-1',
        ),
        'peer-2': mockPeerConnectionStatistics(
          '@user-dave:example.com',
          'connected',
          'session-3',
        ),
      },
      sessions: {},
    };
    observeCommunicationStatisticsSubject.next(communicationStatistics);

    expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(2);

    expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-0',
          overview: false,
          catchUp: true,
        },
      },
      {
        reliable: true,
      },
    );
  });

  it('should broadcast the active frame when a new session is connected in infinite canvas mode in matrix rtc mode', async () => {
    communicationStatistics = {
      localSession: {
        sessionId: 'own',
      },
      peerConnections: {},
      sessions: {},
    };

    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) => {
      switch (name) {
        case 'REACT_APP_INFINITE_CANVAS':
          return 'true';
        case 'REACT_APP_RTC':
          return 'matrixrtc';
        default:
          return defaultValue;
      }
    });

    presentationManager.startPresentation('frame-0');

    communicationStatistics = {
      localSession: {
        sessionId: 'own',
      },
      peerConnections: {
        'https://livekit-jwt.example.com': mockPeerConnectionStatistics(
          '@user:example.com',
          'connected',
          'other',
          ['session-bob'],
        ),
      },
      sessions: {
        'session-bob': {
          userId: '@user-bob:example.com',
        },
      },
    };
    observeCommunicationStatisticsSubject.next(communicationStatistics);

    expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(2);

    expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-0',
          overview: false,
          catchUp: true,
        },
      },
      {
        reliable: true,
      },
    );
  });

  it('should skip broadcasting the active slide when the presentation was cancelled', async () => {
    presentationManager.startPresentation();
    observeActiveSlideIdSubject.next('slide-1');

    communicationStatistics = {
      localSession: {
        sessionId: 'own-new',
      },
      peerConnections: {},
      sessions: {},
    };
    observeCommunicationStatisticsSubject.next(communicationStatistics);

    observeActiveSlideIdSubject.next('slide-2');
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(2);

    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      1,
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: false, slideId: 'slide-0' } },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      2,
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: false, slideId: 'slide-1' } },
      {
        reliable: true,
      },
    );
  });

  it('should skip broadcasting the active frame when the presentation was cancelled in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    presentationManager.startPresentation('frame-0');
    observeActiveFrameElementIdSubject.next('frame-1');

    communicationStatistics = {
      localSession: {
        sessionId: 'own-new',
      },
      peerConnections: {},
      sessions: {},
    };
    observeCommunicationStatisticsSubject.next(communicationStatistics);

    observeActiveFrameElementIdSubject.next('frame-2');
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(2);

    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      1,
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-0',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      2,
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-1',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
  });

  it('should disable the visibility observation when presenting', async () => {
    const visibilityObservations = firstValueFrom(
      enableObserveVisibilityStateSubject.pipe(take(3), toArray()),
    );

    presentationManager.startPresentation();
    presentationManager.stopPresentation();

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_slide',
      content: {
        view: { isEditMode: false, slideId: 'slide-0' },
      },
    });

    expect(await visibilityObservations).toEqual([false, true, true]);
  });

  it('should close observables on destroy', async () => {
    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(toArray()),
    );

    presentationManager.destroy();

    expect(await states).toEqual([{ type: 'idle' }]);
  });

  it('should toggle the edit mode', async () => {
    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(4), toArray()),
    );

    presentationManager.startPresentation();
    presentationManager.toggleEditMode();
    presentationManager.toggleEditMode();

    expect(await states).toEqual([
      { type: 'idle' },
      { type: 'presenting', isEditMode: false },
      { type: 'presenting', isEditMode: true },
      { type: 'presenting', isEditMode: false },
    ]);
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(3);
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      1,
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: false, slideId: 'slide-0' } },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      2,
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: true, slideId: 'slide-0' } },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      3,
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: false, slideId: 'slide-0' } },
      {
        reliable: true,
      },
    );
  });

  it('should toggle the edit mode in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(4), toArray()),
    );

    presentationManager.startPresentation('frame-0');
    presentationManager.toggleEditMode();
    presentationManager.toggleEditMode();

    expect(await states).toEqual([
      { type: 'idle' },
      { type: 'presenting', isEditMode: false },
      { type: 'presenting', isEditMode: true },
      { type: 'presenting', isEditMode: false },
    ]);
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(3);
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      1,
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-0',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      2,
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: true,
          frameId: 'frame-0',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      3,
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-0',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
  });

  it('should deactivate the edit mode when the slide changes', async () => {
    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(4), toArray()),
    );

    presentationManager.startPresentation();
    presentationManager.toggleEditMode();
    observeActiveSlideIdSubject.next('slide-1');

    expect(await states).toEqual([
      { type: 'idle' },
      { type: 'presenting', isEditMode: false },
      { type: 'presenting', isEditMode: true },
      { type: 'presenting', isEditMode: false },
    ]);
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(3);
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      1,
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: false, slideId: 'slide-0' } },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      2,
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: true, slideId: 'slide-0' } },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      3,
      'net.nordeck.whiteboard.present_slide',
      { view: { isEditMode: false, slideId: 'slide-1' } },
      {
        reliable: true,
      },
    );
  });

  it('should deactivate the edit mode when the frame changes in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    const states = firstValueFrom(
      presentationManager.observePresentationState().pipe(take(4), toArray()),
    );

    presentationManager.startPresentation('frame-0');
    presentationManager.toggleEditMode();
    observeActiveFrameElementIdSubject.next('frame-1');

    expect(await states).toEqual([
      { type: 'idle' },
      { type: 'presenting', isEditMode: false },
      { type: 'presenting', isEditMode: true },
      { type: 'presenting', isEditMode: false },
    ]);
    expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(3);
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      1,
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-0',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      2,
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: true,
          frameId: 'frame-0',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
    expect(communicationChannel.broadcastMessage).toHaveBeenNthCalledWith(
      3,
      'net.nordeck.whiteboard.present_frame',
      {
        view: {
          isEditMode: false,
          frameId: 'frame-1',
          overview: false,
        },
      },
      {
        reliable: true,
      },
    );
  });

  it('should clear the undo manager', async () => {
    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_slide',
      content: {
        view: { isEditMode: true, slideId: 'slide-0' },
      },
    });

    expect(whiteboardInstance.clearUndoManager).toHaveBeenCalled();
  });

  it('should clear the undo manager in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_frame',
      content: {
        view: { isEditMode: true, frameId: 'frame-0' },
      },
    });

    expect(whiteboardInstance.clearUndoManager).toHaveBeenCalled();
  });

  it('should not clear the undo manager', async () => {
    presentationManager.toggleEditMode();

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_slide',
      content: {
        view: { isEditMode: true, slideId: 'slide-0' },
      },
    });

    expect(whiteboardInstance.clearUndoManager).not.toHaveBeenCalled();
  });

  it('should not clear the undo manager in infinite canvas mode', async () => {
    vi.mocked(getEnvironment).mockImplementation((name, defaultValue) =>
      name === 'REACT_APP_INFINITE_CANVAS' ? 'true' : defaultValue,
    );

    presentationManager.toggleEditMode();

    messageSubject.next({
      senderUserId: '@user-bob:example.com',
      senderSessionId: 'session-0',
      type: 'net.nordeck.whiteboard.present_frame',
      content: {
        view: { isEditMode: true, frameId: 'frame-0' },
      },
    });

    expect(whiteboardInstance.clearUndoManager).not.toHaveBeenCalled();
  });

  describe('overview and late joiners (infinite canvas)', () => {
    beforeEach(() => {
      vi.mocked(getEnvironment).mockImplementation((name, defaultValue) => {
        switch (name) {
          case 'REACT_APP_INFINITE_CANVAS':
            return 'true';
          case 'REACT_APP_RTC':
            return 'webrtc';
          default:
            return defaultValue;
        }
      });
    });

    const remoteView = (view: object | undefined) =>
      messageSubject.next({
        senderUserId: '@user-bob:example.com',
        senderSessionId: 'session-0',
        type: 'net.nordeck.whiteboard.present_frame',
        content: { view },
      });

    it('should show the overview for everyone', async () => {
      presentationManager.startPresentation('frame-0');
      vi.mocked(communicationChannel.broadcastMessage).mockClear();
      const overview = firstValueFrom(
        presentationManager.observeOverview().pipe(take(2), toArray()),
      );

      presentationManager.setOverview(true);

      expect(await overview).toEqual([false, true]);
      expect(presentationManager.isOverview()).toBe(true);
      expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
        'net.nordeck.whiteboard.present_frame',
        { view: { isEditMode: false, frameId: 'frame-0', overview: true } },
        { reliable: true },
      );
    });

    it('should keep the overview while selecting frames', () => {
      presentationManager.startPresentation('frame-0');
      presentationManager.setOverview(true);
      vi.mocked(communicationChannel.broadcastMessage).mockClear();

      whiteboardInstance.setActiveFrameElementId('frame-1');

      expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
        'net.nordeck.whiteboard.present_frame',
        { view: { isEditMode: false, frameId: 'frame-1', overview: true } },
        { reliable: true },
      );
    });

    it('should close the overview and open a frame with one message', () => {
      presentationManager.startPresentation('frame-0');
      presentationManager.setOverview(true);
      vi.mocked(communicationChannel.broadcastMessage).mockClear();

      presentationManager.setOverview(false, 'frame-2');

      expect(presentationManager.isOverview()).toBe(false);
      expect(whiteboardInstance.getActiveFrameElementId()).toBe('frame-2');
      expect(communicationChannel.broadcastMessage).toHaveBeenCalledTimes(1);
      expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
        'net.nordeck.whiteboard.present_frame',
        { view: { isEditMode: false, frameId: 'frame-2', overview: false } },
        { reliable: true },
      );
    });

    it('should ignore the overview if not presenting', () => {
      presentationManager.setOverview(true);

      expect(presentationManager.isOverview()).toBe(false);
      expect(communicationChannel.broadcastMessage).not.toHaveBeenCalled();
    });

    it('should end the overview with the presentation', () => {
      presentationManager.startPresentation('frame-0');
      presentationManager.setOverview(true);

      presentationManager.stopPresentation();

      expect(presentationManager.isOverview()).toBe(false);
    });

    it('should follow the overview of the presenter', () => {
      remoteView({ isEditMode: false, frameId: 'frame-1', overview: true });

      expect(presentationManager.isOverview()).toBe(true);
      expect(whiteboardInstance.setActiveFrameElementId).toHaveBeenCalledWith(
        'frame-1',
      );

      // older presenters do not send the flag
      remoteView({ isEditMode: false, frameId: 'frame-1' });
      expect(presentationManager.isOverview()).toBe(false);

      remoteView({ isEditMode: false, frameId: 'frame-1', overview: true });
      remoteView(undefined);
      expect(presentationManager.isOverview()).toBe(false);
    });

    it('should mark the frame of a catch-up message for a late joiner', () => {
      remoteView({ isEditMode: false, frameId: 'frame-2', catchUp: true });

      expect(presentationManager.isCatchUpNavigation('frame-2')).toBe(true);

      // the next navigation of the presenter plays the transition
      remoteView({ isEditMode: false, frameId: 'frame-3' });
      expect(presentationManager.isCatchUpNavigation('frame-2')).toBe(false);
      expect(presentationManager.isCatchUpNavigation('frame-3')).toBe(false);
    });

    it('should not mark a catch-up message for the frame that is already shown', () => {
      remoteView({ isEditMode: false, frameId: 'frame-2' });

      remoteView({ isEditMode: false, frameId: 'frame-2', catchUp: true });

      expect(presentationManager.isCatchUpNavigation('frame-2')).toBe(false);
    });

    it('should send catch-up messages to new peers', () => {
      communicationStatistics = {
        localSession: { sessionId: 'own' },
        peerConnections: {},
        sessions: {},
      };
      presentationManager.startPresentation('frame-0');
      presentationManager.setOverview(true);
      vi.mocked(communicationChannel.broadcastMessage).mockClear();

      communicationStatistics = {
        localSession: { sessionId: 'own' },
        peerConnections: {
          'peer-0': mockPeerConnectionStatistics(
            '@user-bob:example.com',
            'connected',
            'session-0',
          ),
        },
        sessions: {},
      };
      observeCommunicationStatisticsSubject.next(communicationStatistics);

      expect(communicationChannel.broadcastMessage).toHaveBeenCalledWith(
        'net.nordeck.whiteboard.present_frame',
        {
          view: {
            isEditMode: false,
            frameId: 'frame-0',
            overview: true,
            catchUp: true,
          },
        },
        { reliable: true },
      );
    });
  });
});
