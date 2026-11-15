import { Link } from 'react-router'
import { Empty } from '@/shared/ui/empty'
import { Button } from '@/shared/ui/button'

/**
 * 关注（P7 才有"关注用户"）。
 *
 * **空态也是设计的一部分。** 一期没有关注功能，与其藏起来，
 * 不如把"这里以后长什么样"说清楚，并给一个当下能做的动作。
 *
 * 将来的形态与「社群」完全一致：左边是关注的人，右边是帖子。
 */
export function FollowingPage() {
  return (
    <div className="mx-auto max-w-[1000px] px-6 pb-24 pt-12" data-testid="following-page">
      <h1 className="m-0 mb-3.5 text-title font-[640]">关注</h1>
      <p className="m-0 mb-10 max-w-[40rem] text-read text-muted-foreground">
        你关注的人发的帖子会出现在这里，按时间排序。
      </p>

      <Empty
        title="关注功能在当前版本还未开放"
        description={
          <>
            开放后，左侧是关注的人，右侧是帖子内容 —— 和「社群」完全一致。
            <br />
            现在你可以先去社群里逛逛。
          </>
        }
        action={
          <Link to="/c">
            <Button size="sm">去社群看看</Button>
          </Link>
        }
      />
    </div>
  )
}
