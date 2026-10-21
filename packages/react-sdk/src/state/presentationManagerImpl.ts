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

import isEqual from 'lodash/isEqual';
import {
  BehaviorSubject,
  combineLatest,
  concat,
  defer,
  distinctUntilChanged,
  filter,
  map,
  Observable,
  of,
  Subject,
  Subscription,
  takeUntil,
  takeWhile,
} from 'rxjs';
import { isDefined, isInfiniteCanvasMode, isMatrixRtcMode } from '../lib';
import {
  CommunicationChannel,
  isValidPresentFrameMessage,
  isValidPresentSlideMessage,
  PRESENT_FRAME_MESSAGE,
  PRESENT_SLIDE_MESSAGE,
  PresentFrame,
  PresentSlide,
} from './communication';
import { isPeerConnected } from './communication/connection';
import {
  PresentationManager,
  PresentationState,
  WhiteboardInstance,
} from './types';

export class PresentationManagerImpl implements PresentationManager {
  private readonly destroySubject = new Subject<void>();

  private currentPresenterSessionId: string | undefined;
  private currentPresenterSessionIdSubject = new BehaviorSubject<
    string | undefined
  >(undefined);

  private activeSlidePublisher: Subscription | undefined;

  private isEditMode: boolean = false;
  private isEditModeSubject = new BehaviorSubject(false);

  private overviewSubject = new BehaviorSubject(false);

  /**
   * Frame that was activated by a catch-up message (see
   * {@link PresentFrame}). Followers jump to it instead of playing the
   * transition.
   */
  private catchUpFrameId: string | undefined;

  constructor(
    private readonly whiteboardInstance: WhiteboardInstance,
    private readonly communicationChannel: CommunicationChannel,
    enableObserveVisibilityStateSubject?: Subject<boolean>,
    /**
     * Presentation messages (start, frame, edit mode, stop) are followed only
     * from users for whom this returns `true` (view-only mode). Not set:
     * from everybody.
     */
    isRemoteSenderAllowed?: (userId: string) => boolean,
  ) {
    this.communicationChannel
      .observeStatistics()
      .pipe(
        filter(
          (statistics) =>
            this.currentPresenterSessionId !== undefined &&
            this.currentPresenterSessionId ===
              statistics.localSession?.sessionId,
        ),
        map((statistics) => {
          if (isMatrixRtcMode()) {
            return Object.values(statistics.peerConnections).flatMap(
              (peer) => peer.remoteParticipantIdentities,
            );
          } else {
            return Object.values(statistics.peerConnections)
              .filter(isPeerConnected)
              .map((peer) => peer.remoteSessionId);
          }
        }),
        distinctUntilChanged(isEqual),
        filter((v) => v.length > 0), // skip when no one to send to
      )
      .subscribe(() => {
        // broadcast the current presentation state to also update users
        // who join the presentation later
        if (isInfiniteCanvasMode()) {
          const activeFrameId =
            this.whiteboardInstance.getActiveFrameElementId();

          if (activeFrameId) {
            this.communicationChannel.broadcastMessage<PresentFrame>(
              PRESENT_FRAME_MESSAGE,
              {
                view: {
                  isEditMode: this.isEditMode,
                  frameId: activeFrameId,
                  overview: this.overviewSubject.value,
                  catchUp: true,
                },
              },
              {
                reliable: true,
              },
            );
          }
        } else {
          const activeSlideId = this.whiteboardInstance.getActiveSlideId();

          if (activeSlideId) {
            this.communicationChannel.broadcastMessage<PresentSlide>(
              PRESENT_SLIDE_MESSAGE,
              {
                view: {
                  isEditMode: this.isEditMode,
                  slideId: activeSlideId,
                },
              },
              {
                reliable: true,
              },
            );
          }
        }
      });

    this.communicationChannel
      .observeMessages()
      .pipe(
        takeUntil(this.destroySubject),
        filter(
          (message) =>
            !isRemoteSenderAllowed ||
            isRemoteSenderAllowed(message.senderUserId),
        ),
      )
      .subscribe((message) => {
        if (isInfiniteCanvasMode()) {
          if (isValidPresentFrameMessage(message)) {
            const { senderSessionId, content } = message;

            if (content.view) {
              this.setCurrentPresenter(senderSessionId);

              // clear the undo manager unless the user is already in edit mode
              if (!this.isEditMode && content.view.isEditMode) {
                whiteboardInstance.clearUndoManager();
              }

              this.setEditMode(content.view.isEditMode);
              const frameId = content.view.frameId;
              if (whiteboardInstance.getActiveFrameElementId() !== frameId) {
                this.catchUpFrameId = content.view.catchUp
                  ? frameId
                  : undefined;
              }
              this.overviewSubject.next(content.view.overview === true);
              whiteboardInstance.setActiveFrameElementId(frameId);
            } else {
              this.setCurrentPresenter(undefined);
              this.setEditMode(false);
              this.overviewSubject.next(false);
              this.catchUpFrameId = undefined;
              whiteboardInstance.setActiveFrameElementId(undefined);
            }
          }
        } else if (isValidPresentSlideMessage(message)) {
          const { senderSessionId, content } = message;

          if (content.view) {
            this.setCurrentPresenter(senderSessionId);

            // clear the undo manager unless the user is already in edit mode
            if (!this.isEditMode && content.view.isEditMode) {
              whiteboardInstance.clearUndoManager();
            }

            this.setEditMode(content.view.isEditMode);
            const slideId = content.view.slideId;
            whiteboardInstance.setActiveSlideId(slideId);
          } else {
            this.setCurrentPresenter(undefined);
            this.setEditMode(false);
          }
        }
      });

    // don't allow the widget to disconnect even if it is hidden
    if (enableObserveVisibilityStateSubject) {
      this.observePresentationState()
        .pipe(map(({ type }) => type !== 'presenting'))
        .subscribe((enabled) => {
          enableObserveVisibilityStateSubject.next(enabled);
        });
    }
  }

  startPresentation(frameElementId?: string): void {
    const localSessionId =
      this.communicationChannel.getStatistics().localSession?.sessionId;

    if (!localSessionId) {
      return;
    }

    this.setCurrentPresenter(localSessionId);
    this.catchUpFrameId = undefined;
    this.overviewSubject.next(false);

    if (frameElementId) {
      this.whiteboardInstance.setActiveFrameElementId(frameElementId);
    }

    this.activeSlidePublisher?.unsubscribe();

    const observable: Observable<string | undefined> = isInfiniteCanvasMode()
      ? this.whiteboardInstance.observeActiveFrameElementId()
      : this.whiteboardInstance.observeActiveSlideId();

    this.activeSlidePublisher = observable
      .pipe(
        filter(isDefined),
        takeWhile(
          () =>
            this.currentPresenterSessionId !== undefined &&
            this.currentPresenterSessionId ===
              this.communicationChannel.getStatistics().localSession?.sessionId,
        ),
      )
      .subscribe((slideOrFrameId) => {
        this.setEditMode(false);

        if (isInfiniteCanvasMode()) {
          this.communicationChannel.broadcastMessage<PresentFrame>(
            PRESENT_FRAME_MESSAGE,
            {
              view: {
                isEditMode: false,
                frameId: slideOrFrameId,
                overview: this.overviewSubject.value,
              },
            },
            {
              reliable: true,
            },
          );
        } else {
          this.communicationChannel.broadcastMessage<PresentSlide>(
            PRESENT_SLIDE_MESSAGE,
            { view: { isEditMode: false, slideId: slideOrFrameId } },
            {
              reliable: true,
            },
          );
        }
      });
  }

  stopPresentation(): void {
    this.setCurrentPresenter(undefined);
    this.setEditMode(false);
    this.overviewSubject.next(false);

    if (isInfiniteCanvasMode()) {
      this.whiteboardInstance.setActiveFrameElementId(undefined);

      this.communicationChannel.broadcastMessage<PresentFrame>(
        PRESENT_FRAME_MESSAGE,
        { view: undefined },
        {
          reliable: true,
        },
      );
    } else {
      this.communicationChannel.broadcastMessage<PresentSlide>(
        PRESENT_SLIDE_MESSAGE,
        { view: undefined },
        {
          reliable: true,
        },
      );
    }
    this.activeSlidePublisher?.unsubscribe();
  }

  observePresentationState(): Observable<PresentationState> {
    return combineLatest([
      concat(
        defer(() => of(this.communicationChannel.getStatistics())),
        this.communicationChannel.observeStatistics(),
      ),
      this.currentPresenterSessionIdSubject,
      this.isEditModeSubject,
    ]).pipe(
      takeUntil(this.destroySubject),
      map(([statistics, presenterSessionId, isEditMode]): PresentationState => {
        if (
          presenterSessionId &&
          presenterSessionId === statistics.localSession?.sessionId
        ) {
          return { type: 'presenting', isEditMode };
        }

        let presenterUserId: string | undefined = undefined;
        if (isMatrixRtcMode()) {
          const presenterSession = presenterSessionId
            ? statistics.sessions[presenterSessionId]
            : undefined;

          if (presenterSession) {
            presenterUserId = presenterSession.userId;
          }
        } else {
          const peerConnection = presenterSessionId
            ? Object.values(statistics.peerConnections).find(
                (c) => c.remoteSessionId === presenterSessionId,
              )
            : undefined;

          if (peerConnection && isPeerConnected(peerConnection)) {
            presenterUserId = peerConnection.remoteUserId;
          }
        }

        if (presenterUserId) {
          return {
            type: 'presentation',
            presenterUserId,
            isEditMode,
          };
        }

        return { type: 'idle' };
      }),
      distinctUntilChanged(isEqual),
    );
  }

  toggleEditMode(): void {
    const isEditMode = !this.isEditMode;
    const slideOrFrameId = isInfiniteCanvasMode()
      ? this.whiteboardInstance.getActiveFrameElementId()
      : this.whiteboardInstance.getActiveSlideId();

    this.setEditMode(isEditMode);

    if (slideOrFrameId) {
      if (isInfiniteCanvasMode()) {
        this.communicationChannel.broadcastMessage<PresentFrame>(
          PRESENT_FRAME_MESSAGE,
          {
            view: {
              isEditMode,
              frameId: slideOrFrameId,
              overview: this.overviewSubject.value,
            },
          },
          {
            reliable: true,
          },
        );
      } else {
        this.communicationChannel.broadcastMessage<PresentSlide>(
          PRESENT_SLIDE_MESSAGE,
          { view: { isEditMode, slideId: slideOrFrameId } },
          {
            reliable: true,
          },
        );
      }
    }
  }

  observeOverview(): Observable<boolean> {
    return this.overviewSubject.pipe(
      distinctUntilChanged(),
      takeUntil(this.destroySubject),
    );
  }

  isOverview(): boolean {
    return this.overviewSubject.value;
  }

  setOverview(overview: boolean, frameElementId?: string): void {
    if (!isInfiniteCanvasMode() || !this.isLocalPresenter()) {
      return;
    }

    const activeFrameId = this.whiteboardInstance.getActiveFrameElementId();
    const targetFrameId = frameElementId ?? activeFrameId;

    if (
      overview === this.overviewSubject.value &&
      targetFrameId === activeFrameId
    ) {
      return;
    }

    this.overviewSubject.next(overview);

    if (targetFrameId !== undefined && targetFrameId !== activeFrameId) {
      // the active frame publisher broadcasts the new view
      this.whiteboardInstance.setActiveFrameElementId(targetFrameId);
    } else if (activeFrameId) {
      this.communicationChannel.broadcastMessage<PresentFrame>(
        PRESENT_FRAME_MESSAGE,
        {
          view: {
            isEditMode: this.isEditMode,
            frameId: activeFrameId,
            overview,
          },
        },
        { reliable: true },
      );
    }
  }

  isCatchUpNavigation(frameElementId: string): boolean {
    return this.catchUpFrameId === frameElementId;
  }

  destroy() {
    this.destroySubject.next();
    this.activeSlidePublisher?.unsubscribe();
    this.activeSlidePublisher = undefined;
    this.currentPresenterSessionId = undefined;
    this.isEditMode = false;
  }

  private isLocalPresenter(): boolean {
    return (
      this.currentPresenterSessionId !== undefined &&
      this.currentPresenterSessionId ===
        this.communicationChannel.getStatistics().localSession?.sessionId
    );
  }

  private setCurrentPresenter(presenterSessionId: string | undefined) {
    this.currentPresenterSessionId = presenterSessionId;
    this.currentPresenterSessionIdSubject.next(presenterSessionId);
  }

  private setEditMode(isEditMode: boolean) {
    this.isEditMode = isEditMode;
    this.isEditModeSubject.next(isEditMode);
  }
}
